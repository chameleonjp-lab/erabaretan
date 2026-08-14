import type { GameState } from "./types.ts";
import { assertGameState } from "./invariants.ts";

/** Advances the deterministic turn counter and removes effects that expire before it. */
export function advanceTurnSequence(state: GameState, nextTurnSequence: number): GameState {
  if (!Number.isSafeInteger(nextTurnSequence) || nextTurnSequence <= state.turnSequence) {
    throw new Error("nextTurnSequence must be greater than the current turnSequence");
  }
  const activeField = state.activeField && state.activeField.expiresAfterTurnSequence > nextTurnSequence
    ? state.activeField
    : null;
  const players = Object.fromEntries(Object.entries(state.players).map(([playerId, player]) => [
    playerId,
    {
      ...player,
      statusEffects: {
        ...player.statusEffects,
        shields: player.statusEffects.shields.filter((shield) => (
          shield.scope === "CURRENT_PENDING_ATTACK"
          || (shield.expiresAfterTurnSequence ?? Number.MAX_SAFE_INTEGER) > nextTurnSequence
        )),
        statModifiers: player.statusEffects.statModifiers.filter((modifier) => modifier.expiresAfterTurnSequence > nextTurnSequence),
      },
    },
  ]));
  const nextState = { ...state, turnSequence: nextTurnSequence, activeField, players };
  assertGameState(nextState);
  return nextState;
}
