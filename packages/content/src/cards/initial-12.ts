import type { EffectCommand, EffectCommandType, EffectPayload } from "../../../game-core/src/effects/types.ts";
import type { CommandValidationOptions } from "../../../game-core/src/commands/validate.ts";
import type { PublicCardRef, PublicGameState } from "../../../game-core/src/public-state.ts";
import type { CardDefinitionId, CardInstanceId, GameState, PlayMode, PlayerId } from "../../../game-core/src/state/types.ts";

type CardRole = "ATTACK" | "DEFENSE" | "INTERVENTION" | "FIELD";
type WorldImpactType = "DAMAGE" | "NEUTRAL" | "RESTORE";
type TemplateTarget = "SELF" | "OPPONENT" | "WORLD" | "CURRENT_PENDING_ATTACK" | "CURRENT_FIELD";
type CardConditionPhase = "ACTION_SELECTION" | "RESPONSE_SELECTION";

interface CardEffectTemplate {
  readonly commandType: EffectCommandType;
  readonly target: TemplateTarget;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attributionPolicy: EffectCommand["attributionPolicy"];
  readonly executionTiming: EffectCommand["executionTiming"];
}

export interface InitialCardDefinition {
  readonly cardDefinitionId: CardDefinitionId;
  readonly cardVersion: 1;
  readonly introducedRulesetId: "ruleset.alpha-12.v1";
  readonly displayName: string;
  readonly role: CardRole;
  readonly worldImpactType: WorldImpactType;
  readonly copiesInDeck: 3;
  readonly modes: Readonly<Record<string, readonly CardEffectTemplate[]>>;
  readonly conditions: Readonly<Record<string, InitialCardCondition>>;
}

export interface InitialCardCondition {
  readonly phase: CardConditionPhase;
  readonly requiresOpponentTarget?: boolean;
  readonly selfHitPointsAtLeast?: number;
  readonly worldBelowMax?: boolean;
  readonly opponentWorldDamageResponsibilityAtLeast?: number;
  readonly activeFieldRequired?: boolean;
  readonly handSizeAtLeast?: number;
  readonly requiresPendingAttackDefender?: boolean;
}

const actionTargetCondition: InitialCardCondition = {
  phase: "ACTION_SELECTION",
  requiresOpponentTarget: true,
};
const actionCondition: InitialCardCondition = { phase: "ACTION_SELECTION" };
const responseCondition: InitialCardCondition = {
  phase: "RESPONSE_SELECTION",
  requiresPendingAttackDefender: true,
};

const damagePlayer = (
  amount: number,
  target: "SELF" | "OPPONENT",
  executionTiming: EffectCommand["executionTiming"] = "AFTER_RESPONSE_MODIFIERS",
): CardEffectTemplate => ({
  commandType: "DAMAGE_PLAYER",
  target,
  payload: { amount, damageKind: "DIRECT" },
  attributionPolicy: "NO_LEDGER",
  executionTiming,
});

const damageWorld = (amount: number): CardEffectTemplate => ({
  commandType: "DAMAGE_WORLD",
  target: "WORLD",
  payload: { amount, reason: "CARD_RELEASE" },
  attributionPolicy: "SOURCE_OWNER",
  executionTiming: "IMMEDIATE",
});

const nextApplicableShield = (amount: number): CardEffectTemplate => ({
  commandType: "ADD_SHIELD",
  target: "SELF",
  payload: { amount, scope: "NEXT_APPLICABLE_ATTACK" },
  attributionPolicy: "NO_LEDGER",
  executionTiming: "IMMEDIATE",
});

export const INITIAL_12_CARD_DEFINITIONS: readonly InitialCardDefinition[] = [
  {
    cardDefinitionId: "attack.steadfast-strike.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "堅実な一撃",
    role: "ATTACK",
    worldImpactType: "NEUTRAL",
    copiesInDeck: 3,
    modes: { RELEASE: [damagePlayer(6, "OPPONENT")] },
    conditions: { RELEASE: actionTargetCondition },
  },
  {
    cardDefinitionId: "attack.star-breaker.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "星砕き",
    role: "ATTACK",
    worldImpactType: "DAMAGE",
    copiesInDeck: 3,
    modes: {
      RELEASE: [damagePlayer(16, "OPPONENT"), damageWorld(7)],
      RESTRAIN: [nextApplicableShield(3)],
    },
    conditions: { RELEASE: actionTargetCondition, RESTRAIN: actionCondition },
  },
  {
    cardDefinitionId: "attack.rift-pebble.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "裂け目の礫",
    role: "ATTACK",
    worldImpactType: "DAMAGE",
    copiesInDeck: 3,
    modes: {
      RELEASE: [damagePlayer(4, "OPPONENT"), damageWorld(2)],
      RESTRAIN: [nextApplicableShield(1)],
    },
    conditions: { RELEASE: actionTargetCondition, RESTRAIN: actionCondition },
  },
  {
    cardDefinitionId: "defense.guardian-veil.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "守りの帳",
    role: "DEFENSE",
    worldImpactType: "NEUTRAL",
    copiesInDeck: 3,
    modes: { RESPONSE: [{ commandType: "ADD_SHIELD", target: "CURRENT_PENDING_ATTACK", payload: { amount: 7, scope: "CURRENT_PENDING_ATTACK" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
    conditions: { RESPONSE: responseCondition },
  },
  {
    cardDefinitionId: "defense.ashen-bulwark.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "灰燼の城壁",
    role: "DEFENSE",
    worldImpactType: "DAMAGE",
    copiesInDeck: 3,
    modes: { RESPONSE: [{ commandType: "ADD_SHIELD", target: "CURRENT_PENDING_ATTACK", payload: { amount: 12, scope: "CURRENT_PENDING_ATTACK" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { ...damageWorld(4), payload: { amount: 4, reason: "CARD_RESPONSE" } }] },
    conditions: { RESPONSE: responseCondition },
  },
  {
    cardDefinitionId: "intervention.verdant-bargain.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "緑の取引",
    role: "INTERVENTION",
    worldImpactType: "RESTORE",
    copiesInDeck: 3,
    modes: { RESPONSE: [{ commandType: "REDUCE_INCOMING_DAMAGE", target: "CURRENT_PENDING_ATTACK", payload: { amount: 3 }, attributionPolicy: "NO_LEDGER", executionTiming: "AFTER_RESPONSE_MODIFIERS" }, { commandType: "RESTORE_WORLD", target: "WORLD", payload: { amount: 4, reason: "CARD_RESPONSE" }, attributionPolicy: "SOURCE_OWNER", executionTiming: "IMMEDIATE" }] },
    conditions: { RESPONSE: responseCondition },
  },
  {
    cardDefinitionId: "intervention.oath-of-renewal.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "再生の誓約",
    role: "INTERVENTION",
    worldImpactType: "RESTORE",
    copiesInDeck: 3,
    modes: { RELEASE: [{ commandType: "PAY_HP", target: "SELF", payload: { amount: 4, minimumRemainingHp: 1 }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { commandType: "RESTORE_WORLD", target: "WORLD", payload: { amount: 7, reason: "CARD_RELEASE" }, attributionPolicy: "SOURCE_OWNER", executionTiming: "IMMEDIATE" }] },
    conditions: { RELEASE: { ...actionCondition, selfHitPointsAtLeast: 5, worldBelowMax: true } },
  },
  {
    cardDefinitionId: "intervention.judgment-of-scars.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "傷痕への審罰",
    role: "INTERVENTION",
    worldImpactType: "NEUTRAL",
    copiesInDeck: 3,
    modes: {
      RELEASE: [damagePlayer(8, "OPPONENT", "IMMEDIATE")],
      RESTRAIN: [damagePlayer(3, "OPPONENT", "IMMEDIATE")],
    },
    conditions: { RELEASE: { ...actionTargetCondition, opponentWorldDamageResponsibilityAtLeast: 5 }, RESTRAIN: actionTargetCondition },
  },
  {
    cardDefinitionId: "field.frenzied-fracture.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "狂奔する亀裂",
    role: "FIELD",
    worldImpactType: "DAMAGE",
    copiesInDeck: 3,
    modes: { RELEASE: [{ commandType: "SET_FIELD", target: "CURRENT_FIELD", payload: { fieldDefinitionId: "field.frenzied-fracture.v1" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
    conditions: { RELEASE: actionCondition },
  },
  {
    cardDefinitionId: "field.root-sanctuary.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "根守りの結界",
    role: "FIELD",
    worldImpactType: "NEUTRAL",
    copiesInDeck: 3,
    modes: { RELEASE: [{ commandType: "SET_FIELD", target: "CURRENT_FIELD", payload: { fieldDefinitionId: "field.root-sanctuary.v1" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
    conditions: { RELEASE: actionCondition },
  },
  {
    cardDefinitionId: "intervention.field-nullification.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "無色の宣告",
    role: "INTERVENTION",
    worldImpactType: "DAMAGE",
    copiesInDeck: 3,
    modes: { RELEASE: [{ commandType: "CLEAR_FIELD", target: "CURRENT_FIELD", payload: { reason: "CARD_RELEASE" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, damageWorld(2)] },
    conditions: { RELEASE: { ...actionCondition, activeFieldRequired: true } },
  },
  {
    cardDefinitionId: "intervention.careful-redraw.v1",
    cardVersion: 1,
    introducedRulesetId: "ruleset.alpha-12.v1",
    displayName: "静かな手直し",
    role: "INTERVENTION",
    worldImpactType: "NEUTRAL",
    copiesInDeck: 3,
    modes: { RELEASE: [{ commandType: "DISCARD_CARD", target: "SELF", payload: { selection: { selectionKind: "NEWEST_CARD_INSTANCE" }, reason: "CARD_EFFECT" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { commandType: "DRAW_CARD", target: "SELF", payload: { count: 1, reason: "CARD_EFFECT" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
    conditions: { RELEASE: { ...actionCondition, handSizeAtLeast: 2 } },
  },
];

export const INITIAL_12_CARD_BY_ID: Readonly<Record<CardDefinitionId, InitialCardDefinition>> = Object.fromEntries(
  INITIAL_12_CARD_DEFINITIONS.map((definition) => [definition.cardDefinitionId, definition]),
);

export interface BuildCardEffectsInput {
  readonly resolutionId: string;
  readonly cardDefinitionId: CardDefinitionId;
  readonly cardInstanceId: string;
  readonly ownerPlayerId: PlayerId;
  readonly mode: PlayMode | "RESPONSE";
  readonly targetPlayerId?: PlayerId;
  readonly pendingAttackId?: string;
  /** The hand card selected by careful-redraw; it must differ from cardInstanceId. */
  readonly discardCardInstanceId?: CardInstanceId;
  readonly turnSequence: number;
}

function resolveTarget(target: TemplateTarget, input: BuildCardEffectsInput) {
  if (target === "SELF") return { targetKind: "PLAYER" as const, playerId: input.ownerPlayerId };
  if (target === "OPPONENT") {
    if (!input.targetPlayerId) throw new Error("targetPlayerId is required for an opponent effect");
    return { targetKind: "PLAYER" as const, playerId: input.targetPlayerId };
  }
  if (target === "WORLD") return { targetKind: "WORLD" as const };
  if (target === "CURRENT_FIELD") return { targetKind: "CURRENT_FIELD" as const };
  if (!input.pendingAttackId) throw new Error("pendingAttackId is required for a response effect");
  return { targetKind: "CURRENT_PENDING_ATTACK" as const, pendingAttackId: input.pendingAttackId };
}

export function buildInitial12CardEffects(input: BuildCardEffectsInput): readonly EffectCommand[] {
  const definition = INITIAL_12_CARD_BY_ID[input.cardDefinitionId];
  if (!definition) throw new Error(`Unknown initial card definition: ${input.cardDefinitionId}`);
  const templates = definition.modes[input.mode];
  if (!templates) throw new Error(`${input.cardDefinitionId} does not support mode ${input.mode}`);
  return templates.map((template, index) => {
    const payload: Record<string, unknown> = { ...template.payload };
    if (template.commandType === "DISCARD_CARD") {
      if (!input.discardCardInstanceId) {
        throw new Error("discardCardInstanceId is required for careful-redraw");
      }
      if (input.discardCardInstanceId === input.cardInstanceId) throw new Error("discardCardInstanceId must differ from the card being resolved");
      payload.selection = {
        selectionKind: "EXPLICIT_CARD_INSTANCE",
        cardInstanceId: input.discardCardInstanceId,
      };
    }
    if (template.commandType === "ADD_SHIELD" && payload.scope === "CURRENT_PENDING_ATTACK") payload.pendingAttackId = input.pendingAttackId;
    if (template.commandType === "ADD_SHIELD" && payload.scope === "NEXT_APPLICABLE_ATTACK") payload.expiresAfterTurnSequence = input.turnSequence + 2;
    if (template.commandType === "SET_FIELD") {
      payload.ownerPlayerId = input.ownerPlayerId;
      payload.expiresAfterTurnSequence = input.turnSequence + 3;
    }
    return {
      effectId: `effect.${input.resolutionId}.${String(index + 1).padStart(4, "0")}`,
      commandType: template.commandType,
      source: {
        sourceKind: "CARD" as const,
        ownerPlayerId: input.ownerPlayerId,
        cardDefinitionId: input.cardDefinitionId,
        cardInstanceId: input.cardInstanceId,
        mode: input.mode,
      },
      target: resolveTarget(template.target, input),
      payload: payload as unknown as EffectPayload,
      attributionPolicy: template.attributionPolicy,
      executionTiming: template.executionTiming,
    };
  });
}

export type Initial12CardConditionCode =
  | "INVALID_CARD"
  | "CARD_NOT_IN_HAND"
  | "INVALID_PHASE"
  | "INVALID_TARGET"
  | "CONDITION_NOT_MET";

export type Initial12CardConditionResult =
  | { readonly ok: true; readonly definition: InitialCardDefinition }
  | { readonly ok: false; readonly code: Initial12CardConditionCode; readonly message: string };

export interface ValidateInitial12CardPlayInput {
  readonly state: GameState;
  readonly playerId: PlayerId;
  readonly cardInstanceId: string;
  readonly mode: PlayMode | "RESPONSE";
  readonly targetPlayerId?: PlayerId | null;
  readonly discardCardInstanceId?: CardInstanceId | null;
}

/**
 * The CPU uses this input instead of authoritative state. It is deliberately
 * shaped around the player-scoped public projection so card conditions cannot
 * accidentally become a hidden-information dependency.
 */
export interface ValidateInitial12CardPublicPlayInput {
  readonly state: PublicGameState;
  readonly playerId: PlayerId;
  readonly card: PublicCardRef;
  readonly mode: PlayMode | "RESPONSE";
  readonly targetPlayerId?: PlayerId | null;
  readonly discardCardInstanceId?: CardInstanceId | null;
}

interface CardConditionPlayerContext {
  readonly hitPoints: number;
  readonly hand: readonly CardInstanceId[];
  readonly handSize: number;
  readonly worldDamageResponsibility: number;
}

interface CardConditionContext {
  readonly phase: string;
  readonly players: Readonly<Record<PlayerId, CardConditionPlayerContext>>;
  readonly worldDurability: number;
  readonly worldMaxDurability: number;
  readonly activeField: unknown | null;
  readonly respondingPlayerId: PlayerId | null;
  readonly pendingActionDefenderId: PlayerId | null;
  readonly pendingAttackDefenderId: PlayerId | null;
  readonly pendingActionAttackId: string | null;
  readonly pendingAttackId: string | null;
  readonly inResolution: readonly CardInstanceId[];
}

function gameStateConditionContext(state: GameState): CardConditionContext {
  const players: Record<PlayerId, CardConditionPlayerContext> = {};
  for (const playerId of state.initialPlayerOrder) {
    const player = state.players[playerId];
    if (!player) continue;
    players[playerId] = {
      hitPoints: player.hitPoints,
      hand: player.hand,
      handSize: player.hand.length,
      worldDamageResponsibility: player.worldDamageResponsibility,
    };
  }
  return {
    phase: state.phase,
    players,
    worldDurability: state.world.durability,
    worldMaxDurability: state.world.maxDurability,
    activeField: state.activeField,
    respondingPlayerId: state.respondingPlayerId,
    pendingActionDefenderId: state.pendingAction?.kind === "RESPONSE_SELECTION"
      ? state.pendingAction.defendingPlayerId
      : null,
    pendingAttackDefenderId: state.pendingAttack?.defendingPlayerId ?? null,
    pendingActionAttackId: state.pendingAction?.kind === "RESPONSE_SELECTION"
      ? state.pendingAction.pendingAttackId
      : null,
    pendingAttackId: state.pendingAttack?.pendingAttackId ?? null,
    inResolution: state.cardZones.inResolution,
  };
}

function publicStateConditionContext(state: PublicGameState): CardConditionContext {
  const players: Record<PlayerId, CardConditionPlayerContext> = {};
  for (const player of state.players) {
    players[player.playerId] = {
      hitPoints: player.hp,
      hand: player.hand.cards?.map((card) => card.cardInstanceId) ?? [],
      handSize: player.hand.count,
      worldDamageResponsibility: player.worldDamageResponsibility,
    };
  }
  return {
    phase: state.phase,
    players,
    worldDurability: state.world.durability,
    worldMaxDurability: state.world.maxDurability,
    activeField: state.activeField,
    respondingPlayerId: state.respondingPlayerId,
    pendingActionDefenderId: state.pendingInteraction?.kind === "RESPONSE_SELECTION"
      ? state.pendingInteraction.defendingPlayerId
      : null,
    pendingAttackDefenderId: state.pendingInteraction?.kind === "RESPONSE_SELECTION"
      ? state.pendingInteraction.defendingPlayerId
      : null,
    pendingActionAttackId: state.pendingInteraction?.kind === "RESPONSE_SELECTION"
      ? state.pendingInteraction.pendingAttackId
      : null,
    pendingAttackId: state.pendingInteraction?.kind === "RESPONSE_SELECTION"
      ? state.pendingInteraction.pendingAttackId
      : null,
    inResolution: state.inResolution.map((card) => card.cardInstanceId),
  };
}

function validateInitial12CardConditions(input: {
  readonly context: CardConditionContext;
  readonly definition: InitialCardDefinition;
  readonly playerId: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly mode: PlayMode | "RESPONSE";
  readonly targetPlayerId?: PlayerId | null;
  readonly discardCardInstanceId?: CardInstanceId | null;
}): Initial12CardConditionResult {
  const condition = input.definition.conditions[input.mode];
  if (!condition) return { ok: false, code: "CONDITION_NOT_MET", message: "card mode is not supported" };
  if (input.context.phase !== condition.phase) {
    return { ok: false, code: "INVALID_PHASE", message: `card mode requires ${condition.phase}` };
  }

  const self = input.context.players[input.playerId];
  if (!self) return { ok: false, code: "INVALID_CARD", message: "player is not in the public match state" };
  if (condition.requiresOpponentTarget) {
    if (!input.targetPlayerId || input.targetPlayerId === input.playerId || !input.context.players[input.targetPlayerId]) {
      return { ok: false, code: "INVALID_TARGET", message: "an opponent target is required" };
    }
  }
  if (condition.requiresPendingAttackDefender) {
    if (
      input.context.phase !== "RESPONSE_SELECTION"
      || input.context.pendingActionDefenderId !== input.playerId
      || input.context.pendingAttackDefenderId !== input.playerId
      || input.context.pendingActionDefenderId !== input.context.pendingAttackDefenderId
      || input.context.respondingPlayerId !== input.playerId
      || input.context.pendingActionAttackId === null
      || input.context.pendingAttackId === null
      || input.context.pendingActionAttackId !== input.context.pendingAttackId
    ) {
      return { ok: false, code: "CONDITION_NOT_MET", message: "the player is not the current pending-attack defender" };
    }
  }
  if (condition.selfHitPointsAtLeast !== undefined && self.hitPoints < condition.selfHitPointsAtLeast) {
    return { ok: false, code: "CONDITION_NOT_MET", message: "self hit points are below the card condition" };
  }
  if (condition.worldBelowMax && input.context.worldDurability >= input.context.worldMaxDurability) {
    return { ok: false, code: "CONDITION_NOT_MET", message: "the world is already at maximum durability" };
  }
  if (condition.opponentWorldDamageResponsibilityAtLeast !== undefined) {
    const target = input.targetPlayerId ? input.context.players[input.targetPlayerId] : undefined;
    if (!target || target.worldDamageResponsibility < condition.opponentWorldDamageResponsibilityAtLeast) {
      return { ok: false, code: "CONDITION_NOT_MET", message: "the opponent's world-damage responsibility is below the card condition" };
    }
  }
  if (condition.activeFieldRequired && !input.context.activeField) {
    return { ok: false, code: "CONDITION_NOT_MET", message: "an active field is required" };
  }
  if (condition.handSizeAtLeast !== undefined && self.handSize < condition.handSizeAtLeast) {
    return { ok: false, code: "CONDITION_NOT_MET", message: "the hand is below the card condition" };
  }
  if (input.definition.cardDefinitionId === "intervention.careful-redraw.v1") {
    if (
      !input.discardCardInstanceId
      || input.discardCardInstanceId === input.cardInstanceId
      || !self.hand.includes(input.discardCardInstanceId)
      || input.context.inResolution.includes(input.discardCardInstanceId)
    ) {
      return { ok: false, code: "CONDITION_NOT_MET", message: "careful-redraw must discard another card from the player's hand" };
    }
  }
  return { ok: true, definition: input.definition };
}

/**
 * Validates the alpha-12 catalog conditions without putting card-specific
 * knowledge into game-core. The command layer can call this after the generic
 * command shape/ownership checks have passed.
 */
export function validateInitial12CardPlay(input: ValidateInitial12CardPlayInput): Initial12CardConditionResult {
  const card = input.state.cardInstances[input.cardInstanceId];
  if (!card) return { ok: false, code: "INVALID_CARD", message: "card instance does not exist" };
  if (card.ownerPlayerId !== input.playerId || !input.state.cardZones.hands[input.playerId]?.includes(input.cardInstanceId)) {
    return { ok: false, code: "CARD_NOT_IN_HAND", message: "card instance is not in the player's hand" };
  }
  const definition = INITIAL_12_CARD_BY_ID[card.cardDefinitionId];
  if (!definition) return { ok: false, code: "INVALID_CARD", message: "card definition is not in the alpha-12 catalog" };
  return validateInitial12CardConditions({
    context: gameStateConditionContext(input.state),
    definition,
    playerId: input.playerId,
    cardInstanceId: input.cardInstanceId,
    mode: input.mode,
    targetPlayerId: input.targetPlayerId,
    discardCardInstanceId: input.discardCardInstanceId,
  });
}

/** Validates the same catalog condition contract against a player-scoped view. */
export function validateInitial12CardPlayFromPublicState(input: ValidateInitial12CardPublicPlayInput): Initial12CardConditionResult {
  const ownPlayer = input.state.players.find((player) => player.playerId === input.playerId);
  const publicCard = ownPlayer?.hand.cards?.find((card) => card.cardInstanceId === input.card.cardInstanceId);
  if (!publicCard) {
    return { ok: false, code: "CARD_NOT_IN_HAND", message: "card instance is not in the player's public hand" };
  }
  if (publicCard.cardDefinitionId !== input.card.cardDefinitionId) {
    return { ok: false, code: "INVALID_CARD", message: "public card definition does not match the player's hand" };
  }
  const definition = INITIAL_12_CARD_BY_ID[publicCard.cardDefinitionId];
  if (!definition) return { ok: false, code: "INVALID_CARD", message: "card definition is not in the alpha-12 catalog" };
  return validateInitial12CardConditions({
    context: publicStateConditionContext(input.state),
    definition,
    playerId: input.playerId,
    cardInstanceId: input.card.cardInstanceId,
    mode: input.mode,
    targetPlayerId: input.targetPlayerId,
    discardCardInstanceId: input.discardCardInstanceId,
  });
}

export const initial12CommandValidationOptions: CommandValidationOptions = {
  cardConditionValidator: (input) => {
    const validation = validateInitial12CardPlay(input);
    if (validation.ok === true) return { ok: true };
    return {
      ok: false,
      code: validation.code === "INVALID_TARGET" ? "INVALID_TARGET" : "CARD_CONDITION_NOT_MET",
      message: validation.message,
    };
  },
};
