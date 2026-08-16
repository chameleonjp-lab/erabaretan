import {
  createAlpha12Setup,
  executeAlpha12Command,
} from "../content.ts";
import {
  advanceToNextTurnStart,
  finalizeTerminalState,
  resolveTurnStart,
  type Command,
  type GameState,
  type ReplayCommandExecution,
} from "../../../packages/game-core/src/index.ts";

export const H2_TRIAL_SEEDS = [
  "00000000000000000000000000000001",
  "00000000000000000000000000000002",
  "00000000000000000000000000000003",
  "00000000000000000000000000000004",
  "00000000000000000000000000000005",
  "00000000000000000000000000000006",
  "00000000000000000000000000000007",
  "00000000000000000000000000000008",
] as const;

export const H2_TRIAL_GAME_COUNT = H2_TRIAL_SEEDS.length;

export function trialSeedForMatch(matchNumber: number): string {
  const index = Math.max(0, matchNumber - 1) % H2_TRIAL_SEEDS.length;
  return H2_TRIAL_SEEDS[index];
}

export function createLocalMatch(matchNumber: number): GameState {
  return createAlpha12Setup({
    matchId: `p4-03-h2-human-trial-${matchNumber}`,
    seed: trialSeedForMatch(matchNumber),
    playerIds: ["P1", "P2"],
  }).state;
}

/** Resolves the input-free hand refill step used between two local actions. */
export function normalizeLocalTurnStart(state: GameState): GameState {
  let nextState = state;
  while (nextState.phase === "TURN_START") {
    const playerId = nextState.activePlayerId;
    if (!playerId || nextState.players[playerId].hand.length > nextState.ruleset.handLimit) return nextState;
    nextState = resolveTurnStart(nextState);
  }
  return nextState;
}

/** Applies a command through the production content executor, then prepares the next local turn. */
export function applyLocalCommand(state: GameState, command: Command): ReplayCommandExecution {
  const result = executeAlpha12Command(state, command);
  if (!result.accepted || result.replayed) return result;
  const prepared = result.state.phase === "TURN_END"
    ? advanceToNextTurnStart(result.state)
    : result.state;
  const terminal = finalizeTerminalState(prepared);
  return { ...result, state: normalizeLocalTurnStart(terminal) };
}
