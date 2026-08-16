import type {
  ActiveFieldState,
  CardDefinitionId,
  CardInstanceId,
  GameState,
  GamePhase,
  PlayerId,
  PlayMode,
  ShieldScope,
  StatModifierName,
} from "./state/types.ts";
import { assertGameState } from "./state/invariants.ts";

export const PUBLIC_STATE_VERSION = "public-state.alpha-12.v1" as const;

export type StateViewer =
  | { readonly kind: "PLAYER"; readonly playerId: PlayerId }
  | { readonly kind: "SPECTATOR" };

export interface PublicCardRef {
  readonly cardInstanceId: CardInstanceId;
  readonly cardDefinitionId: CardDefinitionId;
}

export interface PublicHand {
  readonly count: number;
  /** The exact cards for the viewer's own hand; null for every hidden hand. */
  readonly cards: readonly PublicCardRef[] | null;
}

export interface PublicShieldState {
  readonly amount: number;
  readonly scope: ShieldScope;
  readonly pendingAttackId: string | null;
  readonly expiresAfterTurnSequence: number | null;
}

export interface PublicStatModifierState {
  readonly stat: StatModifierName;
  readonly delta: number;
  readonly expiresAfterTurnSequence: number;
}

export interface PublicPlayerStatusEffects {
  readonly nextDefensePenalty: number;
  readonly fragileWorld: boolean;
  readonly shields: readonly PublicShieldState[];
  readonly statModifiers: readonly PublicStatModifierState[];
}

export interface PublicPlayerState {
  readonly playerId: PlayerId;
  readonly hp: number;
  readonly maxHp: number;
  readonly hand: PublicHand;
  readonly worldDamageResponsibility: number;
  readonly effectiveWorldRestore: number;
  readonly survivedRoundCount: number;
  readonly statusEffects: PublicPlayerStatusEffects;
}

export interface PublicWorldState {
  readonly durability: number;
  readonly maxDurability: number;
  readonly triggeredThresholds: readonly number[];
  readonly worldLawId: string;
  readonly collapseResponsiblePlayerId: PlayerId | null;
}

export interface PublicActiveFieldState {
  readonly fieldDefinitionId: CardDefinitionId;
  readonly ownerPlayerId: PlayerId;
  readonly expiresAfterTurnSequence: number;
}

export interface PublicPendingInteraction {
  readonly kind: "RESPONSE_SELECTION" | "CARD_RESOLUTION";
  readonly pendingAttackId: string | null;
  readonly attackingPlayerId: PlayerId;
  readonly defendingPlayerId: PlayerId | null;
  readonly playerId: PlayerId;
  readonly card: PublicCardRef;
  readonly playMode: PlayMode;
  readonly targetPlayerId: PlayerId | null;
  /** The published base damage; defense-dependent values are intentionally absent. */
  readonly baseDamage: number | null;
}

export interface PublicTerminalFlags {
  readonly worldCollapsed: boolean;
  readonly defeatedPlayerIds: readonly PlayerId[];
  readonly maxRoundsReached: boolean;
  readonly endKind: NonNullable<GameState["terminalFlags"]["endKind"]> | null;
  readonly battleWinnerId: PlayerId | null;
  readonly divineSelectionWinnerId: PlayerId | null;
}

export interface PublicGameState {
  readonly publicStateVersion: typeof PUBLIC_STATE_VERSION;
  readonly matchId: string;
  readonly rulesetId: string;
  /** Public rule data required to decide whether an overflow discard is legal. */
  readonly handLimit: number;
  readonly catalogHash: string;
  readonly engineVersion: string;
  readonly revision: number;
  readonly phase: GamePhase;
  readonly roundNumber: number;
  readonly turnSequence: number;
  readonly initialPlayerOrder: readonly PlayerId[];
  readonly activePlayerId: PlayerId | null;
  readonly respondingPlayerId: PlayerId | null;
  readonly players: readonly PublicPlayerState[];
  readonly drawPileCount: number;
  readonly discardPile: readonly PublicCardRef[];
  readonly revealedCards: readonly PublicCardRef[];
  readonly inResolution: readonly PublicCardRef[];
  readonly world: PublicWorldState;
  readonly activeField: PublicActiveFieldState | null;
  readonly pendingInteraction: PublicPendingInteraction | null;
  readonly terminalFlags: PublicTerminalFlags;
}

export type PublicStateResult =
  | { readonly ok: true; readonly state: PublicGameState }
  | { readonly ok: false; readonly code: "UNKNOWN_VIEWER" | "INVALID_STATE" };

class InvalidPublicStateError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveViewer(state: GameState, viewer: unknown): StateViewer | null {
  if (!isRecord(viewer) || typeof viewer.kind !== "string") return null;
  if (viewer.kind === "SPECTATOR") return { kind: "SPECTATOR" };
  if (viewer.kind !== "PLAYER" || typeof viewer.playerId !== "string" || !state.players[viewer.playerId]) return null;
  return { kind: "PLAYER", playerId: viewer.playerId };
}

function cardRef(state: GameState, cardInstanceId: CardInstanceId): PublicCardRef {
  const card = state.cardInstances[cardInstanceId];
  if (!card || card.cardInstanceId !== cardInstanceId || typeof card.cardDefinitionId !== "string") {
    throw new InvalidPublicStateError(`public card reference is invalid: ${cardInstanceId}`);
  }
  return { cardInstanceId: card.cardInstanceId, cardDefinitionId: card.cardDefinitionId };
}

function cardRefs(state: GameState, cardInstanceIds: readonly CardInstanceId[]): PublicCardRef[] {
  return cardInstanceIds.map((cardInstanceId) => cardRef(state, cardInstanceId));
}

function publicHand(state: GameState, playerId: PlayerId, viewer: StateViewer): PublicHand {
  const hand = state.cardZones.hands[playerId];
  if (!hand || !state.players[playerId]) throw new InvalidPublicStateError(`hand is invalid: ${playerId}`);
  const cards = viewer.kind === "PLAYER" && viewer.playerId === playerId ? cardRefs(state, hand) : null;
  return { count: hand.length, cards };
}

function publicActiveField(field: ActiveFieldState | null): PublicActiveFieldState | null {
  if (!field) return null;
  return {
    fieldDefinitionId: field.fieldDefinitionId,
    ownerPlayerId: field.ownerPlayerId,
    expiresAfterTurnSequence: field.expiresAfterTurnSequence,
  };
}

function publicPendingInteraction(state: GameState): PublicPendingInteraction | null {
  const pending = state.pendingAction;
  if (!pending) return null;
  if (pending.kind === "RESPONSE_SELECTION") {
    const attack = state.pendingAttack;
    return {
      kind: "RESPONSE_SELECTION",
      pendingAttackId: pending.pendingAttackId,
      attackingPlayerId: pending.attackingPlayerId,
      defendingPlayerId: pending.defendingPlayerId,
      playerId: pending.attackingPlayerId,
      card: cardRef(state, pending.cardInstanceId),
      playMode: pending.playMode,
      targetPlayerId: pending.targetPlayerId,
      baseDamage: attack?.pendingAttackId === pending.pendingAttackId ? attack.baseDamage : null,
    };
  }
  const attack = state.pendingAttack;
  return {
    kind: "CARD_RESOLUTION",
    pendingAttackId: attack?.pendingAttackId ?? null,
    attackingPlayerId: attack?.attackingPlayerId ?? pending.playerId,
    defendingPlayerId: attack?.defendingPlayerId ?? null,
    playerId: pending.playerId,
    card: cardRef(state, pending.cardInstanceId),
    playMode: pending.playMode,
    targetPlayerId: pending.targetPlayerId,
    baseDamage: attack?.baseDamage ?? null,
  };
}

function publicStatusEffects(state: GameState, playerId: PlayerId): PublicPlayerStatusEffects {
  const effects = state.players[playerId].statusEffects;
  return {
    nextDefensePenalty: effects.nextDefensePenalty,
    fragileWorld: effects.fragileWorld,
    shields: effects.shields.map((shield) => ({
      amount: shield.amount,
      scope: shield.scope,
      pendingAttackId: shield.pendingAttackId,
      expiresAfterTurnSequence: shield.expiresAfterTurnSequence,
    })),
    statModifiers: effects.statModifiers.map((modifier) => ({
      stat: modifier.stat,
      delta: modifier.delta,
      expiresAfterTurnSequence: modifier.expiresAfterTurnSequence,
    })),
  };
}

function project(state: GameState, viewer: StateViewer): PublicGameState {
  const players = state.initialPlayerOrder.map((playerId) => {
    const player = state.players[playerId];
    if (!player) throw new InvalidPublicStateError(`player is invalid: ${playerId}`);
    return {
      playerId,
      hp: player.hitPoints,
      maxHp: player.maxHitPoints,
      hand: publicHand(state, playerId, viewer),
      worldDamageResponsibility: player.worldDamageResponsibility,
      effectiveWorldRestore: player.effectiveWorldRestore,
      survivedRoundCount: player.survivedRoundCount,
      statusEffects: publicStatusEffects(state, playerId),
    };
  });

  return {
    publicStateVersion: PUBLIC_STATE_VERSION,
    matchId: state.matchId,
    rulesetId: state.ruleset.rulesetId,
    handLimit: state.ruleset.handLimit,
    catalogHash: state.catalogHash,
    engineVersion: state.engineVersion,
    revision: state.revision,
    phase: state.phase,
    roundNumber: state.roundNumber,
    turnSequence: state.turnSequence,
    initialPlayerOrder: [...state.initialPlayerOrder],
    activePlayerId: state.activePlayerId,
    respondingPlayerId: state.respondingPlayerId,
    players,
    drawPileCount: state.cardZones.drawPile.length,
    discardPile: cardRefs(state, state.cardZones.discardPile),
    revealedCards: cardRefs(state, state.cardZones.revealedCards),
    inResolution: cardRefs(state, state.cardZones.inResolution),
    world: {
      durability: state.world.durability,
      maxDurability: state.world.maxDurability,
      triggeredThresholds: [...state.world.triggeredThresholds],
      worldLawId: state.world.worldLawId,
      collapseResponsiblePlayerId: state.world.collapseResponsiblePlayerId,
    },
    activeField: publicActiveField(state.activeField),
    pendingInteraction: publicPendingInteraction(state),
    terminalFlags: {
      worldCollapsed: state.terminalFlags.worldCollapsed,
      defeatedPlayerIds: [...state.terminalFlags.defeatedPlayerIds],
      maxRoundsReached: state.terminalFlags.maxRoundsReached,
      endKind: state.terminalFlags.endKind,
      battleWinnerId: state.terminalFlags.battleWinnerId,
      divineSelectionWinnerId: state.terminalFlags.divineSelectionWinnerId,
    },
  };
}

/** Projects authoritative state into the viewer-specific, secret-safe state. */
export function projectPublicState(state: GameState, viewer: unknown): PublicStateResult {
  const resolvedViewer = resolveViewer(state, viewer);
  if (!resolvedViewer) return { ok: false, code: "UNKNOWN_VIEWER" };
  try {
    assertGameState(state);
    return { ok: true, state: project(state, resolvedViewer) };
  } catch {
    return { ok: false, code: "INVALID_STATE" };
  }
}

export const getPublicState = projectPublicState;
export const createPublicState = projectPublicState;
