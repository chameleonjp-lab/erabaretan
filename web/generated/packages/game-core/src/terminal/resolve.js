import { assertGameState } from "../state/invariants.js";
import { calculateJudgment } from "../judgment/calculate.js";
function hasCollapsePenalty(state, playerId) {
    return state.scoreModifiers.some((modifier) => modifier.playerId === playerId && modifier.modifierKind === "WORLD_COLLAPSE_PENALTY");
}
function battleWinnerId(state, defeatedPlayerIds) {
    const alive = state.initialPlayerOrder.filter((playerId) => !defeatedPlayerIds.includes(playerId));
    if (alive.length === 1)
        return alive[0];
    return null;
}
/**
 * Applies the normal terminal conditions after all mandatory resolution and
 * world-law reactions have completed. Surrender and other non-normal endings
 * are left untouched.
 */
export function finalizeTerminalState(state) {
    if (state.phase === "FINISHED" || state.terminalFlags.endKind !== null)
        return state;
    const defeatedPlayerIds = state.initialPlayerOrder.filter((playerId) => state.players[playerId].hitPoints <= 0);
    const worldCollapsed = state.world.durability === 0 || state.terminalFlags.worldCollapsed;
    // roundNumber advances after both players complete a round. The value
    // maxRounds + 1 therefore represents the first state after the final
    // allowed round has completed.
    const maxRoundsReached = state.roundNumber > state.ruleset.maxRounds;
    if (defeatedPlayerIds.length === 0 && !worldCollapsed && !maxRoundsReached)
        return state;
    let scoreModifiers = [...state.scoreModifiers];
    const collapseOwner = state.world.collapseResponsiblePlayerId;
    if (worldCollapsed && collapseOwner && !hasCollapsePenalty(state, collapseOwner)) {
        const collapsePenalty = {
            playerId: collapseOwner,
            modifierKind: "WORLD_COLLAPSE_PENALTY",
            amount: state.ruleset.worldCollapsePenalty,
        };
        scoreModifiers.push(collapsePenalty);
    }
    const flagsWithoutJudgment = {
        ...state.terminalFlags,
        worldCollapsed,
        defeatedPlayerIds,
        maxRoundsReached,
        endKind: "NORMAL",
        battleWinnerId: battleWinnerId(state, defeatedPlayerIds),
        divineSelectionWinnerId: null,
    };
    const preJudgment = {
        ...state,
        phase: "FINISHED",
        activePlayerId: null,
        respondingPlayerId: null,
        pendingAction: null,
        pendingAttack: null,
        effectQueue: [],
        scoreModifiers,
        terminalFlags: flagsWithoutJudgment,
        judgment: null,
    };
    const judgment = calculateJudgment(preJudgment);
    const finalState = {
        ...preJudgment,
        judgment,
        terminalFlags: { ...flagsWithoutJudgment, divineSelectionWinnerId: judgment.winnerId },
    };
    assertGameState(finalState);
    return finalState;
}
