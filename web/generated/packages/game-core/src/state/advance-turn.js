import { assertGameState } from "./invariants.js";
/** Advances the deterministic turn counter and removes effects that expire before it. */
export function advanceTurnSequence(state, nextTurnSequence) {
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
                shields: player.statusEffects.shields.filter((shield) => (shield.scope === "CURRENT_PENDING_ATTACK"
                    || (shield.expiresAfterTurnSequence ?? Number.MAX_SAFE_INTEGER) > nextTurnSequence)),
                statModifiers: player.statusEffects.statModifiers.filter((modifier) => modifier.expiresAfterTurnSequence > nextTurnSequence),
            },
        },
    ]));
    const nextState = { ...state, turnSequence: nextTurnSequence, activeField, players };
    assertGameState(nextState);
    return nextState;
}
/**
 * Completes a non-terminal turn and positions the next player at TURN_START.
 *
 * The transition is internal to the command/effect pipeline, so it does not
 * consume a command revision. A harness that processes TURN_START may then
 * advance the revision when it changes the phase or draws a card.
 */
export function advanceToNextTurnStart(state) {
    if (state.phase !== "TURN_END")
        throw new Error("next turn can only begin from TURN_END");
    if (!state.activePlayerId)
        throw new Error("TURN_END requires an active player");
    const currentIndex = state.initialPlayerOrder.indexOf(state.activePlayerId);
    if (currentIndex < 0)
        throw new Error("active player is not in initialPlayerOrder");
    const nextPlayerId = state.initialPlayerOrder[(currentIndex + 1) % state.initialPlayerOrder.length];
    const nextTurnSequence = state.turnSequence + 1;
    const nextRoundNumber = Math.floor((nextTurnSequence - 1) / state.initialPlayerOrder.length) + 1;
    const prepared = {
        ...state,
        phase: "TURN_START",
        roundNumber: nextRoundNumber,
        activePlayerId: nextPlayerId,
        respondingPlayerId: null,
        pendingAction: null,
        pendingAttack: null,
        effectQueue: [],
    };
    return advanceTurnSequence(prepared, nextTurnSequence);
}
/**
 * Resolves the deterministic, input-free part of TURN_START.
 *
 * The first player starts with the prepared starting hand. Every later turn
 * draws one card before action selection; if that draw exceeds the hand
 * limit, the state remains in TURN_START so DISCARD_OVERFLOW can be issued.
 * This transition is intentionally separate from command reduction because
 * it is an engine step, not a client command.
 */
export function resolveTurnStart(state) {
    if (state.phase !== "TURN_START")
        throw new Error("turn start can only be resolved from TURN_START");
    if (!state.activePlayerId)
        throw new Error("TURN_START requires an active player");
    const playerId = state.activePlayerId;
    const player = state.players[playerId];
    if (!player)
        throw new Error(`Unknown active player: ${playerId}`);
    // An overflow state is waiting for DISCARD_OVERFLOW. Re-running the
    // input-free step must not draw another card or consume a revision.
    if (player.hand.length > state.ruleset.handLimit) {
        assertGameState(state);
        return state;
    }
    const shouldDraw = state.turnSequence > 1 && player.hand.length < state.ruleset.handLimit;
    const drawCardId = shouldDraw ? state.cardZones.drawPile[0] : undefined;
    const nextHand = drawCardId ? [...player.hand, drawCardId] : [...player.hand];
    const nextDrawPile = drawCardId ? state.cardZones.drawPile.slice(1) : [...state.cardZones.drawPile];
    const nextPlayers = {
        ...state.players,
        [playerId]: { ...player, hand: nextHand },
    };
    const nextCardInstances = drawCardId
        ? {
            ...state.cardInstances,
            [drawCardId]: { ...state.cardInstances[drawCardId], ownerPlayerId: playerId, zone: "HAND" },
        }
        : state.cardInstances;
    const nextState = {
        ...state,
        phase: nextHand.length > state.ruleset.handLimit ? "TURN_START" : "ACTION_SELECTION",
        revision: state.revision + 1,
        players: nextPlayers,
        cardZones: {
            ...state.cardZones,
            drawPile: nextDrawPile,
            hands: { ...state.cardZones.hands, [playerId]: nextHand },
        },
        cardInstances: nextCardInstances,
    };
    assertGameState(nextState);
    return nextState;
}
