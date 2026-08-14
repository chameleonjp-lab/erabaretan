import type {
  ActiveFieldState,
  CardInstanceId,
  CardInstanceState,
  CardZones,
  GamePhase,
  GameState,
  PlayerId,
  PlayerState,
  RulesetSnapshot,
} from "./types.ts";
import { assertGameState } from "./invariants.ts";
import { ALPHA_12_RULESET } from "./rules.ts";

export interface InitialPlayerInput {
  readonly playerId: PlayerId;
  readonly hand: readonly CardInstanceId[];
  readonly hitPoints?: number;
  readonly worldDamageResponsibility?: number;
  readonly effectiveWorldRestore?: number;
  readonly survivedRoundCount?: number;
  readonly nextDefensePenalty?: number;
  readonly fragileWorld?: boolean;
}

export interface CreateInitialGameStateInput {
  readonly matchId: string;
  readonly catalogHash: string;
  readonly engineVersion: string;
  readonly rngAlgorithmVersion: string;
  readonly shuffleAlgorithmVersion: string;
  readonly seed: string;
  readonly ruleset?: RulesetSnapshot;
  readonly players: readonly [InitialPlayerInput, InitialPlayerInput];
  readonly initialPlayerOrder?: readonly [PlayerId, PlayerId];
  readonly firstPlayerId: PlayerId;
  readonly cardInstances: readonly CardInstanceState[];
  readonly drawPile: readonly CardInstanceId[];
  readonly discardPile?: readonly CardInstanceId[];
  readonly revealedCards?: readonly CardInstanceId[];
  readonly phase?: GamePhase;
  readonly revision?: number;
  readonly roundNumber?: number;
  readonly turnSequence?: number;
  readonly worldDurability?: number;
  readonly triggeredThresholds?: readonly number[];
  readonly activeField?: ActiveFieldState | null;
  readonly collapseResponsiblePlayerId?: PlayerId | null;
  readonly randomConsumptionCount?: number;
}

function createPlayer(input: InitialPlayerInput, ruleset: RulesetSnapshot, fragileWorldFromThreshold: boolean): PlayerState {
  return {
    playerId: input.playerId,
    hitPoints: input.hitPoints ?? ruleset.startingHp,
    maxHitPoints: ruleset.maxHp,
    hand: [...input.hand],
    worldDamageResponsibility: input.worldDamageResponsibility ?? 0,
    effectiveWorldRestore: input.effectiveWorldRestore ?? 0,
    survivedRoundCount: input.survivedRoundCount ?? 1,
    statusEffects: {
      nextDefensePenalty: input.nextDefensePenalty ?? 0,
      fragileWorld: input.fragileWorld ?? fragileWorldFromThreshold,
      shields: [],
      statModifiers: [],
    },
  };
}

export function createInitialGameState(input: CreateInitialGameStateInput): GameState {
  const ruleset = input.ruleset ?? ALPHA_12_RULESET;
  const playerInputs = input.players;
  const fragileWorldFromThreshold = input.triggeredThresholds?.includes(25) ?? false;
  const players: Record<PlayerId, PlayerState> = {};
  for (const playerInput of playerInputs) {
    if (players[playerInput.playerId]) {
      throw new Error(`Duplicate playerId: ${playerInput.playerId}`);
    }
    players[playerInput.playerId] = createPlayer(playerInput, ruleset, fragileWorldFromThreshold);
  }

  if (!players[input.firstPlayerId]) {
    throw new Error(`firstPlayerId is not one of the players: ${input.firstPlayerId}`);
  }

  const cardInstances: Record<CardInstanceId, CardInstanceState> = {};
  for (const card of input.cardInstances) {
    if (cardInstances[card.cardInstanceId]) {
      throw new Error(`Duplicate cardInstanceId: ${card.cardInstanceId}`);
    }
    cardInstances[card.cardInstanceId] = { ...card };
  }

  const cardZones: CardZones = {
    drawPile: [...input.drawPile],
    hands: Object.fromEntries(playerInputs.map((player) => [player.playerId, [...player.hand]])),
    discardPile: [...(input.discardPile ?? [])],
    revealedCards: [...(input.revealedCards ?? [])],
    inResolution: [],
  };

  const state: GameState = {
    stateHashVersion: "state-hash.alpha-12.v1",
    ruleset,
    catalogHash: input.catalogHash,
    engineVersion: input.engineVersion,
    rngAlgorithmVersion: input.rngAlgorithmVersion,
    shuffleAlgorithmVersion: input.shuffleAlgorithmVersion,
    matchId: input.matchId,
    seed: input.seed,
    initialPlayerOrder: [...(input.initialPlayerOrder ?? [playerInputs[0].playerId, playerInputs[1].playerId])],
    revision: input.revision ?? 0,
    phase: input.phase ?? "ACTION_SELECTION",
    roundNumber: input.roundNumber ?? 1,
    turnSequence: input.turnSequence ?? 1,
    activePlayerId: input.firstPlayerId,
    respondingPlayerId: null,
    players,
    cardZones,
    cardInstances,
    world: {
      durability: input.worldDurability ?? ruleset.startingWorldDurability,
      maxDurability: ruleset.worldMaxDurability,
      triggeredThresholds: [...(input.triggeredThresholds ?? [])],
      worldLawId: ruleset.worldLawId,
      collapseResponsiblePlayerId: input.collapseResponsiblePlayerId ?? null,
    },
    activeField: input.activeField ?? null,
    pendingAction: null,
    pendingAttack: null,
    effectQueue: [],
    scoreModifiers: [],
    terminalFlags: {
      worldCollapsed: false,
      defeatedPlayerIds: [],
      maxRoundsReached: false,
      endKind: null,
      battleWinnerId: null,
      divineSelectionWinnerId: null,
    },
    judgment: null,
    randomConsumptionCount: input.randomConsumptionCount ?? 0,
    commandHistory: {},
  };

  assertGameState(state);
  return state;
}
