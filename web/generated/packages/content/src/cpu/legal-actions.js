import { projectPublicState } from "../../../game-core/src/public-state.js";
import { INITIAL_12_CATALOG, validateInitial12CardPlayFromPublicState, } from "../cards/initial-12.js";
const COMMAND_RANK = {
    PLAY_CARD: 10,
    SELECT_RESPONSE: 20,
    DISCARD_FOR_ACTION: 30,
    DISCARD_OVERFLOW: 40,
    ACCEPT_DAMAGE: 50,
    SURRENDER: 60,
};
function compareUtf8(left, right) {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
        if (leftBytes[index] !== rightBytes[index])
            return leftBytes[index] - rightBytes[index];
    }
    return leftBytes.length - rightBytes.length;
}
function ownHand(view, playerId) {
    return view.players.find((player) => player.playerId === playerId)?.hand.cards ?? null;
}
function opponents(view, playerId) {
    return view.players
        .map((player) => player.playerId)
        .filter((candidate) => candidate !== playerId)
        .sort(compareUtf8);
}
function pushPlayCardActions(view, playerId, card, opponentIds, actions, catalog) {
    const definition = catalog.byId[card.cardDefinitionId];
    if (!definition)
        return;
    const modes = Object.keys(definition.modes)
        .filter((mode) => mode === "RELEASE" || mode === "RESTRAIN");
    const discardCandidates = definition.cardDefinitionId === "intervention.careful-redraw.v1"
        ? (ownHand(view, playerId) ?? []).map((candidate) => candidate.cardInstanceId).filter((candidate) => candidate !== card.cardInstanceId)
        : [undefined];
    for (const mode of modes) {
        const condition = definition.conditions[mode];
        const targetCandidates = condition?.requiresOpponentTarget ? opponentIds : [undefined];
        for (const targetPlayerId of targetCandidates) {
            for (const discardCardInstanceId of discardCandidates) {
                const validation = validateInitial12CardPlayFromPublicState({
                    state: view,
                    playerId,
                    card,
                    mode,
                    targetPlayerId,
                    discardCardInstanceId,
                }, catalog);
                if (!validation.ok)
                    continue;
                actions.push({
                    commandType: "PLAY_CARD",
                    playerId,
                    payload: {
                        cardInstanceId: card.cardInstanceId,
                        playMode: mode,
                        ...(targetPlayerId ? { targetPlayerId } : {}),
                        ...(discardCardInstanceId ? { discardCardInstanceId } : {}),
                    },
                });
            }
        }
    }
}
function actionCardInstanceId(action) {
    if (action.commandType === "PLAY_CARD" || action.commandType === "SELECT_RESPONSE")
        return action.payload.cardInstanceId;
    if (action.commandType === "DISCARD_FOR_ACTION" || action.commandType === "DISCARD_OVERFLOW")
        return action.payload.cardInstanceId;
    return "";
}
function actionMode(action) {
    if (action.commandType === "PLAY_CARD")
        return action.payload.playMode;
    if (action.commandType === "SELECT_RESPONSE")
        return action.payload.responseMode;
    return "";
}
function actionTarget(action) {
    return action.commandType === "PLAY_CARD" ? action.payload.targetPlayerId ?? "" : "";
}
function actionDiscard(action) {
    return action.commandType === "PLAY_CARD" ? action.payload.discardCardInstanceId ?? "" : "";
}
function compareActions(left, right) {
    const rank = COMMAND_RANK[left.commandType] - COMMAND_RANK[right.commandType];
    if (rank !== 0)
        return rank;
    for (const [leftValue, rightValue] of [
        [actionCardInstanceId(left), actionCardInstanceId(right)],
        [actionMode(left), actionMode(right)],
        [actionTarget(left), actionTarget(right)],
        [actionDiscard(left), actionDiscard(right)],
    ]) {
        const compared = compareUtf8(leftValue, rightValue);
        if (compared !== 0)
            return compared;
    }
    return compareUtf8(left.playerId, right.playerId);
}
/**
 * Enumerates all alpha-12 choices available from a player-scoped public view.
 * It intentionally does not receive GameState, seed, draw-pile order, or
 * command history. Surrender is a legal player command; timeout fallback is a
 * server/system operation and is not a CPU choice.
 */
export function enumerateAlpha12CpuActions(view, playerId, catalog = INITIAL_12_CATALOG) {
    const hand = ownHand(view, playerId);
    if (!hand)
        return [];
    const actions = [];
    const opponentIds = opponents(view, playerId);
    if (view.phase === "ACTION_SELECTION" && view.activePlayerId === playerId) {
        for (const card of hand)
            pushPlayCardActions(view, playerId, card, opponentIds, actions, catalog);
        for (const card of hand) {
            actions.push({
                commandType: "DISCARD_FOR_ACTION",
                playerId,
                payload: { cardInstanceId: card.cardInstanceId },
            });
        }
    }
    if (view.phase === "RESPONSE_SELECTION" && view.respondingPlayerId === playerId) {
        for (const card of hand) {
            const definition = catalog.byId[card.cardDefinitionId];
            if (!definition?.modes.RESPONSE)
                continue;
            const validation = validateInitial12CardPlayFromPublicState({
                state: view,
                playerId,
                card,
                mode: "RESPONSE",
            }, catalog);
            if (validation.ok) {
                actions.push({
                    commandType: "SELECT_RESPONSE",
                    playerId,
                    payload: { cardInstanceId: card.cardInstanceId, responseMode: "RESPONSE" },
                });
            }
        }
        actions.push({ commandType: "ACCEPT_DAMAGE", playerId, payload: {} });
    }
    if (view.phase === "TURN_START" && view.activePlayerId === playerId && hand.length > view.handLimit) {
        for (const card of hand) {
            actions.push({
                commandType: "DISCARD_OVERFLOW",
                playerId,
                payload: { cardInstanceId: card.cardInstanceId },
            });
        }
    }
    if (view.phase === "ACTION_SELECTION" || view.phase === "RESPONSE_SELECTION") {
        actions.push({ commandType: "SURRENDER", playerId, payload: {} });
    }
    return actions.sort(compareActions);
}
/** Adds the authoritative command envelope after a choice has been selected. */
export function materializeAlpha12CpuCommand(action, expectedRevision, commandId) {
    const base = { commandId, playerId: action.playerId, expectedRevision };
    switch (action.commandType) {
        case "PLAY_CARD":
            return { ...base, commandType: action.commandType, payload: action.payload };
        case "SELECT_RESPONSE":
            return { ...base, commandType: action.commandType, payload: action.payload };
        case "DISCARD_FOR_ACTION":
            return { ...base, commandType: action.commandType, payload: action.payload };
        case "DISCARD_OVERFLOW":
            return { ...base, commandType: action.commandType, payload: action.payload };
        case "ACCEPT_DAMAGE":
            return { ...base, commandType: action.commandType, payload: action.payload };
        case "SURRENDER":
            return { ...base, commandType: action.commandType, payload: action.payload };
    }
}
function commandIdSegment(value) {
    return value.replace(/[^A-Za-z0-9._:#-]/g, "-").slice(0, 32) || "player";
}
export function alpha12CpuCommandId(playerId, revision, ordinal) {
    return `cpu.${commandIdSegment(playerId)}.r${revision}.a${String(ordinal).padStart(4, "0")}`;
}
/** Convenience adapter for a local authoritative state; enumeration itself remains public-view only. */
export function generateAlpha12CpuLegalCommands(state, playerId, catalog = INITIAL_12_CATALOG) {
    const projected = projectPublicState(state, { kind: "PLAYER", playerId });
    if (!projected.ok)
        return [];
    return enumerateAlpha12CpuActions(projected.state, playerId, catalog).map((action, index) => (materializeAlpha12CpuCommand(action, projected.state.revision, alpha12CpuCommandId(playerId, projected.state.revision, index + 1))));
}
