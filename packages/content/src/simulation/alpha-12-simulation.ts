import type { Command } from "../../../game-core/src/commands/types.ts";
import {
  ALPHA_12_RULESET,
  advanceToNextTurnStart,
  finalizeTerminalState,
  hashGameState,
  projectPublicState,
  resolveTurnStart,
  summarizeMatch,
  type CardDefinitionId,
  type GameState,
  type PlayerId,
  type PublicGameState,
} from "../../../game-core/src/index.ts";
import { INITIAL_12_CARD_BY_ID, INITIAL_12_CARD_DEFINITIONS } from "../cards/initial-12.ts";
import {
  alpha12CpuCommandId,
  enumerateAlpha12CpuActions,
  materializeAlpha12CpuCommand,
  type CpuActionIntent,
} from "../cpu/legal-actions.ts";
import { createAlpha12Setup } from "../setup/alpha-12.ts";
import { executeAlpha12Command } from "../setup/alpha-12-command-executor.ts";

/** The first P4-02 policy is intentionally simple and public-state-only. */
export const ALPHA_12_CPU_POLICY_ID = "public-greedy-v1" as const;
export const ALPHA_12_SIMULATION_VERSION = "simulation-metrics.alpha-12.v1" as const;
export const DEFAULT_MAX_SIMULATION_STEPS = 4096;

const THRESHOLDS = [75, 50, 25] as const;
const OATH_OF_RENEWAL_ID = "intervention.oath-of-renewal.v1";
const SIMULATION_END_KINDS = [
  "NORMAL",
  "SURRENDER",
  "DISCONNECT_FORFEIT",
  "SERVER_ABORT",
  "INVALID_MATCH",
] as const;

export type SimulationEndKind = typeof SIMULATION_END_KINDS[number];
export type SimulationThreshold = typeof THRESHOLDS[number];
export type SimulationRate = number | null;

export interface Alpha12SimulationOptions {
  /** Seeds are supplied by the caller so a measurement run is reproducible. */
  readonly seeds: readonly string[];
  readonly matchIdPrefix?: string;
  readonly maxStepsPerMatch?: number;
}

export interface Alpha12ThresholdRounds {
  readonly 75: number | null;
  readonly 50: number | null;
  readonly 25: number | null;
}

export interface Alpha12CardUsage {
  readonly count: number;
  /** Share of all card plays, including response cards. */
  readonly rate: SimulationRate;
}

export interface Alpha12SimulationMatchRecord {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly seed: string;
  readonly rulesetId: string;
  readonly cpuPolicyId: typeof ALPHA_12_CPU_POLICY_ID;
  readonly endKind: SimulationEndKind;
  readonly finalStateHash: string;
  readonly firstPlayerId: PlayerId;
  readonly finalRoundNumber: number;
  /** Completed rounds; a max-round terminal state records maxRounds here. */
  readonly rounds: number;
  readonly thresholdRounds: Alpha12ThresholdRounds;
  readonly worldCollapsed: boolean;
  readonly maxRoundsReached: boolean;
  readonly battleWinnerId: PlayerId | null;
  readonly divineSelectionWinnerId: PlayerId | null;
  readonly playedCardCount: number;
  /** PLAY_CARD and SELECT_RESPONSE combined. */
  readonly cardUseCount: number;
  readonly releaseCount: number;
  readonly restrainCount: number;
  readonly cardUsage: Readonly<Record<CardDefinitionId, number>>;
  readonly oathOfRenewalUseCount: number;
  readonly oathOfRenewalSurvivalCount: number;
  readonly discardForActionCount: number;
  /** PLAY_CARD and DISCARD_FOR_ACTION decisions in ACTION_SELECTION. */
  readonly actionDecisionCount: number;
}

export interface Alpha12SimulationMetrics {
  readonly matchCount: number;
  readonly endKindCounts: Readonly<Record<SimulationEndKind, number>>;
  readonly totalRounds: number;
  readonly averageRounds: SimulationRate;
  readonly worldCollapseCount: number;
  readonly worldCollapseRate: SimulationRate;
  readonly maxRoundsCount: number;
  readonly maxRoundsRate: SimulationRate;
  readonly playedCardCount: number;
  readonly cardUseCount: number;
  readonly releaseCount: number;
  readonly releaseRate: SimulationRate;
  readonly restrainCount: number;
  readonly restrainRate: SimulationRate;
  readonly cardUsage: Readonly<Record<CardDefinitionId, Alpha12CardUsage>>;
  readonly divineSelectionAwardedCount: number;
  readonly firstPlayerDivineSelectionCount: number;
  readonly firstPlayerDivineSelectionRate: SimulationRate;
  readonly battleDivineComparableCount: number;
  readonly battleDivineAgreementCount: number;
  readonly battleDivineAgreementRate: SimulationRate;
  readonly oathOfRenewalUseMatchCount: number;
  readonly oathOfRenewalUseRate: SimulationRate;
  readonly oathOfRenewalUseCount: number;
  readonly oathOfRenewalSurvivalCount: number;
  readonly oathOfRenewalSurvivalRate: SimulationRate;
  readonly discardForActionCount: number;
  readonly actionDecisionCount: number;
  readonly discardForActionRate: SimulationRate;
  readonly thresholdReachedCounts: Readonly<Record<SimulationThreshold, number>>;
  readonly thresholdReachedRates: Readonly<Record<SimulationThreshold, SimulationRate>>;
}

export interface Alpha12SimulationResult {
  readonly simulationVersion: typeof ALPHA_12_SIMULATION_VERSION;
  readonly rulesetId: string;
  readonly cpuPolicyId: typeof ALPHA_12_CPU_POLICY_ID;
  readonly matches: readonly Alpha12SimulationMatchRecord[];
  readonly metrics: Alpha12SimulationMetrics;
}

interface MutableMatchCounters {
  playedCardCount: number;
  releaseCount: number;
  restrainCount: number;
  cardUsage: Record<CardDefinitionId, number>;
  oathUsers: Set<PlayerId>;
  discardForActionCount: number;
  actionDecisionCount: number;
}

function ratio(numerator: number, denominator: number): SimulationRate {
  return denominator === 0 ? null : numerator / denominator;
}

function emptyCardCounts(): Record<CardDefinitionId, number> {
  return Object.fromEntries(INITIAL_12_CARD_DEFINITIONS.map((definition) => [definition.cardDefinitionId, 0]));
}

function emptyThresholdRounds(): { -readonly [Key in SimulationThreshold]: number | null } {
  return { 75: null, 50: null, 25: null };
}

function emptyThresholdCounts(): { -readonly [Key in SimulationThreshold]: number } {
  return { 75: 0, 50: 0, 25: 0 };
}

function emptyEndKindCounts(): { -readonly [Key in SimulationEndKind]: number } {
  return {
    NORMAL: 0,
    SURRENDER: 0,
    DISCONNECT_FORFEIT: 0,
    SERVER_ABORT: 0,
    INVALID_MATCH: 0,
  };
}

function cardDefinitionForCommand(state: GameState, command: Command): CardDefinitionId | null {
  if (command.commandType === "PLAY_CARD") return state.cardInstances[command.payload.cardInstanceId]?.cardDefinitionId ?? null;
  if (command.commandType === "SELECT_RESPONSE") return state.cardInstances[command.payload.cardInstanceId]?.cardDefinitionId ?? null;
  return null;
}

function observeThresholds(state: GameState, rounds: { -readonly [Key in SimulationThreshold]: number | null }): void {
  for (const threshold of THRESHOLDS) {
    if (rounds[threshold] === null && state.world.triggeredThresholds.includes(threshold)) {
      rounds[threshold] = state.roundNumber;
    }
  }
}

function createCounters(): MutableMatchCounters {
  return {
    playedCardCount: 0,
    releaseCount: 0,
    restrainCount: 0,
    cardUsage: emptyCardCounts(),
    oathUsers: new Set(),
    discardForActionCount: 0,
    actionDecisionCount: 0,
  };
}

function actionCardDefinitionId(view: PublicGameState, action: CpuActionIntent): CardDefinitionId | null {
  if (action.commandType === "PLAY_CARD" || action.commandType === "SELECT_RESPONSE") {
    return playerById(view, action.playerId)?.hand.cards?.find(
      (card) => card.cardInstanceId === action.payload.cardInstanceId,
    )?.cardDefinitionId ?? null;
  }
  return null;
}

function playerById(view: PublicGameState, playerId: PlayerId | null) {
  return playerId ? view.players.find((player) => player.playerId === playerId) ?? null : null;
}

/**
 * Chooses from already validated public candidates. The score is deliberately
 * a small heuristic, not a balance change or a hidden-state search.
 */
function scorePublicAction(view: PublicGameState, action: CpuActionIntent): number {
  if (action.commandType === "SURRENDER") return -10000;
  if (action.commandType === "ACCEPT_DAMAGE") return 0;
  if (action.commandType === "DISCARD_OVERFLOW") return 1;
  if (action.commandType === "DISCARD_FOR_ACTION") return view.world.durability <= 75 ? 35 : 4;

  const cardDefinitionId = actionCardDefinitionId(view, action);
  const definition = cardDefinitionId ? INITIAL_12_CARD_BY_ID[cardDefinitionId] : undefined;
  if (!definition) return -1000;

  if (action.commandType === "SELECT_RESPONSE") {
    let score = 40;
    if (definition.worldImpactType === "RESTORE") score += 10;
    if (definition.worldImpactType === "DAMAGE" && view.world.durability <= 50) score -= 15;
    return score;
  }

  let score = action.payload.playMode === "RELEASE" ? 20 : 18;
  if (action.payload.playMode === "RELEASE") {
    score += definition.role === "ATTACK" ? 8 : 0;
    if (definition.worldImpactType === "DAMAGE") {
      score -= view.world.durability <= 25 ? 35 : view.world.durability <= 50 ? 20 : 0;
    }
    if (definition.worldImpactType === "RESTORE") {
      score += view.world.durability <= 50 ? 15 : 5;
    }
    if (cardDefinitionId === "intervention.oath-of-renewal.v1") {
      const owner = playerById(view, action.playerId);
      if (owner && owner.hp <= 12) score += 20;
    }
    const target = playerById(view, action.payload.targetPlayerId ?? null);
    if (target && target.hp <= 8) score += 20;
  } else {
    if (view.world.durability <= 50) score += 18;
    if (view.world.durability <= 25) score += 15;
    if (view.world.durability <= 75) score += 20;
  }
  return score;
}

function choosePublicGreedyAction(view: PublicGameState, actions: readonly CpuActionIntent[]): CpuActionIntent | undefined {
  return actions.reduce<CpuActionIntent | undefined>((best, action) => {
    if (!best || scorePublicAction(view, action) > scorePublicAction(view, best)) return action;
    return best;
  }, undefined);
}

function commandForPublicGreedyAction(state: GameState): Command {
  const playerId = state.phase === "RESPONSE_SELECTION" ? state.respondingPlayerId : state.activePlayerId;
  if (!playerId) throw new Error(`simulation cannot choose a player in ${state.phase}`);
  const projected = projectPublicState(state, { kind: "PLAYER", playerId });
  if (!projected.ok) throw new Error(`simulation public projection failed: ${projected.code}`);
  const actions = enumerateAlpha12CpuActions(projected.state, playerId);
  const action = choosePublicGreedyAction(projected.state, actions);
  if (!action) throw new Error(`simulation found no legal action in ${state.phase}`);
  return materializeAlpha12CpuCommand(
    action,
    state.revision,
    alpha12CpuCommandId(playerId, state.revision, 1),
  );
}

function runMatch(seed: string, matchIndex: number, options: Required<Pick<Alpha12SimulationOptions, "matchIdPrefix" | "maxStepsPerMatch">>): Alpha12SimulationMatchRecord {
  const matchId = `${options.matchIdPrefix}.${String(matchIndex + 1).padStart(4, "0")}`;
  const setup = createAlpha12Setup({ matchId, seed });
  let state = setup.state;
  const counters = createCounters();
  const thresholdRounds = emptyThresholdRounds();
  let steps = 0;
  observeThresholds(state, thresholdRounds);

  while (state.phase !== "FINISHED") {
    steps += 1;
    if (steps > options.maxStepsPerMatch) {
      throw new Error(`simulation exceeded ${options.maxStepsPerMatch} steps for ${matchId}`);
    }

    if (state.phase === "TURN_START") {
      const resolved = resolveTurnStart(state);
      state = resolved;
      observeThresholds(state, thresholdRounds);
      if (state.phase !== "TURN_START") continue;
    }

    if (state.phase === "TURN_END") {
      const terminal = finalizeTerminalState(state);
      state = terminal.phase === "FINISHED" ? terminal : advanceToNextTurnStart(terminal);
      observeThresholds(state, thresholdRounds);
      continue;
    }

    const before = state;
    const command = commandForPublicGreedyAction(state);
    const cardDefinitionId = cardDefinitionForCommand(before, command);
    if (before.phase === "ACTION_SELECTION") {
      if (command.commandType === "PLAY_CARD" || command.commandType === "DISCARD_FOR_ACTION") {
        counters.actionDecisionCount += 1;
      }
      if (command.commandType === "DISCARD_FOR_ACTION") counters.discardForActionCount += 1;
    }
    if (command.commandType === "PLAY_CARD") {
      counters.playedCardCount += 1;
      if (command.payload.playMode === "RELEASE") counters.releaseCount += 1;
      if (command.payload.playMode === "RESTRAIN") counters.restrainCount += 1;
    }
    if (cardDefinitionId && (command.commandType === "PLAY_CARD" || command.commandType === "SELECT_RESPONSE")) {
      counters.cardUsage[cardDefinitionId] = (counters.cardUsage[cardDefinitionId] ?? 0) + 1;
      if (cardDefinitionId === OATH_OF_RENEWAL_ID && command.commandType === "PLAY_CARD") {
        counters.oathUsers.add(command.playerId);
      }
    }

    const execution = executeAlpha12Command(state, command);
    if (!execution.accepted || execution.replayed) {
      throw new Error(`simulation command was not accepted: ${execution.error?.code ?? "REPLAYED"}`);
    }
    state = execution.state;
    observeThresholds(state, thresholdRounds);
  }

  const endKind = state.terminalFlags.endKind;
  if (!endKind) throw new Error(`simulation ended without endKind for ${matchId}`);
  const summary = summarizeMatch(state);
  if (!summary.ok) throw new Error(`simulation final summary failed: ${summary.code}`);
  const oathOfRenewalSurvivalCount = [...counters.oathUsers]
    .filter((playerId) => state.players[playerId].hitPoints > 0)
    .length;
  const rounds = Math.min(Math.max(state.roundNumber - 1, 0), state.ruleset.maxRounds);
  const cardUseCount = Object.values(counters.cardUsage).reduce((total, count) => total + count, 0);
  return {
    matchIndex,
    matchId,
    seed,
    rulesetId: state.ruleset.rulesetId,
    cpuPolicyId: ALPHA_12_CPU_POLICY_ID,
    endKind,
    finalStateHash: hashGameState(state),
    firstPlayerId: setup.firstPlayerId,
    finalRoundNumber: state.roundNumber,
    rounds,
    thresholdRounds: { ...thresholdRounds },
    worldCollapsed: state.terminalFlags.worldCollapsed,
    maxRoundsReached: state.terminalFlags.maxRoundsReached,
    battleWinnerId: state.terminalFlags.battleWinnerId,
    divineSelectionWinnerId: state.terminalFlags.divineSelectionWinnerId,
    playedCardCount: counters.playedCardCount,
    cardUseCount,
    releaseCount: counters.releaseCount,
    restrainCount: counters.restrainCount,
    cardUsage: { ...counters.cardUsage },
    oathOfRenewalUseCount: counters.oathUsers.size,
    oathOfRenewalSurvivalCount,
    discardForActionCount: counters.discardForActionCount,
    actionDecisionCount: counters.actionDecisionCount,
  };
}

function aggregateMetrics(matches: readonly Alpha12SimulationMatchRecord[]): Alpha12SimulationMetrics {
  const endKindCounts = emptyEndKindCounts();
  const cardCounts = emptyCardCounts();
  const thresholdReachedCounts = emptyThresholdCounts();
  let totalRounds = 0;
  let worldCollapseCount = 0;
  let maxRoundsCount = 0;
  let playedCardCount = 0;
  let cardUseCount = 0;
  let releaseCount = 0;
  let restrainCount = 0;
  let divineSelectionAwardedCount = 0;
  let firstPlayerDivineSelectionCount = 0;
  let battleDivineComparableCount = 0;
  let battleDivineAgreementCount = 0;
  let oathOfRenewalUseMatchCount = 0;
  let oathOfRenewalUseCount = 0;
  let oathOfRenewalSurvivalCount = 0;
  let discardForActionCount = 0;
  let actionDecisionCount = 0;

  for (const match of matches) {
    endKindCounts[match.endKind] += 1;
    totalRounds += match.rounds;
    if (match.worldCollapsed) worldCollapseCount += 1;
    if (match.maxRoundsReached) maxRoundsCount += 1;
    playedCardCount += match.playedCardCount;
    cardUseCount += match.cardUseCount;
    releaseCount += match.releaseCount;
    restrainCount += match.restrainCount;
    if (match.endKind === "NORMAL" && match.divineSelectionWinnerId !== null) {
      divineSelectionAwardedCount += 1;
      if (match.divineSelectionWinnerId === match.firstPlayerId) firstPlayerDivineSelectionCount += 1;
    }
    if (
      match.endKind === "NORMAL"
      && match.battleWinnerId !== null
      && match.divineSelectionWinnerId !== null
      && match.battleWinnerId === match.divineSelectionWinnerId
    ) {
      battleDivineComparableCount += 1;
      battleDivineAgreementCount += 1;
    } else if (
      match.endKind === "NORMAL"
      && match.battleWinnerId !== null
      && match.divineSelectionWinnerId !== null
    ) {
      battleDivineComparableCount += 1;
    }
    if (match.oathOfRenewalUseCount > 0) oathOfRenewalUseMatchCount += 1;
    oathOfRenewalUseCount += match.oathOfRenewalUseCount;
    oathOfRenewalSurvivalCount += match.oathOfRenewalSurvivalCount;
    discardForActionCount += match.discardForActionCount;
    actionDecisionCount += match.actionDecisionCount;
    for (const definition of INITIAL_12_CARD_DEFINITIONS) {
      cardCounts[definition.cardDefinitionId] += match.cardUsage[definition.cardDefinitionId] ?? 0;
    }
    for (const threshold of THRESHOLDS) {
      if (match.thresholdRounds[threshold] !== null) thresholdReachedCounts[threshold] += 1;
    }
  }

  const cardUsage: Record<CardDefinitionId, Alpha12CardUsage> = {};
  for (const definition of INITIAL_12_CARD_DEFINITIONS) {
    const cardDefinitionId = definition.cardDefinitionId;
    cardUsage[cardDefinitionId] = {
      count: cardCounts[cardDefinitionId],
      rate: ratio(cardCounts[cardDefinitionId], cardUseCount),
    };
  }
  const endKindCountsReadonly = { ...endKindCounts };
  return {
    matchCount: matches.length,
    endKindCounts: endKindCountsReadonly,
    totalRounds,
    averageRounds: ratio(totalRounds, matches.length),
    worldCollapseCount,
    worldCollapseRate: ratio(worldCollapseCount, matches.length),
    maxRoundsCount,
    maxRoundsRate: ratio(maxRoundsCount, matches.length),
    playedCardCount,
    cardUseCount,
    releaseCount,
    releaseRate: ratio(releaseCount, playedCardCount),
    restrainCount,
    restrainRate: ratio(restrainCount, playedCardCount),
    cardUsage,
    divineSelectionAwardedCount,
    firstPlayerDivineSelectionCount,
    firstPlayerDivineSelectionRate: ratio(firstPlayerDivineSelectionCount, divineSelectionAwardedCount),
    battleDivineComparableCount,
    battleDivineAgreementCount,
    battleDivineAgreementRate: ratio(battleDivineAgreementCount, battleDivineComparableCount),
    oathOfRenewalUseMatchCount,
    oathOfRenewalUseRate: ratio(oathOfRenewalUseMatchCount, matches.length),
    oathOfRenewalUseCount,
    oathOfRenewalSurvivalCount,
    oathOfRenewalSurvivalRate: ratio(oathOfRenewalSurvivalCount, oathOfRenewalUseCount),
    discardForActionCount,
    actionDecisionCount,
    discardForActionRate: ratio(discardForActionCount, actionDecisionCount),
    thresholdReachedCounts: { ...thresholdReachedCounts },
    thresholdReachedRates: {
      75: ratio(thresholdReachedCounts[75], matches.length),
      50: ratio(thresholdReachedCounts[50], matches.length),
      25: ratio(thresholdReachedCounts[25], matches.length),
    },
  };
}

/** Runs deterministic CPU-vs-CPU matches and returns replay-friendly per-match records plus aggregate metrics. */
export function runAlpha12Simulation(options: Alpha12SimulationOptions): Alpha12SimulationResult {
  const matchIdPrefix = options.matchIdPrefix ?? "simulation.alpha-12";
  const maxStepsPerMatch = options.maxStepsPerMatch ?? DEFAULT_MAX_SIMULATION_STEPS;
  if (!Number.isSafeInteger(maxStepsPerMatch) || maxStepsPerMatch <= 0) {
    throw new Error("maxStepsPerMatch must be a positive safe integer");
  }
  const matches = options.seeds.map((seed, matchIndex) => runMatch(seed, matchIndex, { matchIdPrefix, maxStepsPerMatch }));
  return {
    simulationVersion: ALPHA_12_SIMULATION_VERSION,
    rulesetId: matches[0]?.rulesetId ?? ALPHA_12_RULESET.rulesetId,
    cpuPolicyId: ALPHA_12_CPU_POLICY_ID,
    matches,
    metrics: aggregateMetrics(matches),
  };
}
