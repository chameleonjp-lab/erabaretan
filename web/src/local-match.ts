import {
  createAlpha12Setup,
  executeAlpha12Command,
} from "../../packages/content/src/index.ts";
import {
  advanceToNextTurnStart,
  finalizeTerminalState,
  resolveTurnStart,
  type Command,
  type GameState,
  type ReplayCommandExecution,
} from "../../packages/game-core/src/index.ts";

export const LOCAL_MATCH_SEED = "123456789abcdef00fedcba987654321" as const;

export function createLocalMatch(matchNumber: number): GameState {
  return createAlpha12Setup({
    matchId: `p3-01-local-${matchNumber}`,
    seed: LOCAL_MATCH_SEED,
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
