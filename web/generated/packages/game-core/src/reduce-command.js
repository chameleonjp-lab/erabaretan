import { assertGameState } from "./state/invariants.js";
import { validateCommand } from "./commands/validate.js";
function without(values, value) {
    const index = values.indexOf(value);
    if (index < 0)
        throw new Error(`Value is not present: ${String(value)}`);
    return [...values.slice(0, index), ...values.slice(index + 1)];
}
function append(values, value) {
    return [...values, value];
}
function moveHandCard(state, playerId, cardInstanceId, to) {
    const hand = state.cardZones.hands[playerId];
    if (!hand.includes(cardInstanceId))
        throw new Error(`Card is not in hand: ${cardInstanceId}`);
    const nextHands = { ...state.cardZones.hands, [playerId]: without(hand, cardInstanceId) };
    const nextPlayer = { ...state.players[playerId], hand: [...nextHands[playerId]] };
    const nextPlayers = { ...state.players, [playerId]: nextPlayer };
    const currentCard = state.cardInstances[cardInstanceId];
    const nextCard = { ...currentCard, zone: to };
    const nextCardInstances = { ...state.cardInstances, [cardInstanceId]: nextCard };
    const nextZones = {
        ...state.cardZones,
        hands: nextHands,
        discardPile: to === "DISCARD_PILE" ? append(state.cardZones.discardPile, cardInstanceId) : [...state.cardZones.discardPile],
        inResolution: to === "RESOLUTION" ? append(state.cardZones.inResolution, cardInstanceId) : [...state.cardZones.inResolution],
    };
    return { nextHands, nextPlayers, nextCardInstances, nextZones };
}
function acceptedEvent(commandId, revision) {
    return { type: "COMMAND_ACCEPTED", commandId, revision };
}
function moveToResolution(state, command, revision) {
    const moved = moveHandCard(state, command.playerId, command.payload.cardInstanceId, "RESOLUTION");
    const card = state.cardInstances[command.payload.cardInstanceId];
    const pendingAction = {
        kind: "CARD_RESOLUTION",
        pendingActionId: `pending.${command.commandId}`,
        commandId: command.commandId,
        playerId: command.playerId,
        cardInstanceId: command.payload.cardInstanceId,
        cardDefinitionId: card.cardDefinitionId,
        playMode: command.payload.playMode,
        targetPlayerId: command.payload.targetPlayerId ?? null,
        discardCardInstanceId: command.payload.discardCardInstanceId ?? null,
        responseCardInstanceId: null,
        responseMode: null,
    };
    const played = {
        type: "CARD_PLAYED",
        commandId: command.commandId,
        playerId: command.playerId,
        cardInstanceId: command.payload.cardInstanceId,
        playMode: command.payload.playMode,
        revision,
    };
    return {
        state: {
            ...state,
            phase: "RESOLUTION",
            revision,
            cardZones: moved.nextZones,
            players: moved.nextPlayers,
            cardInstances: moved.nextCardInstances,
            pendingAction,
            pendingAttack: null,
            respondingPlayerId: null,
        },
        events: [played],
    };
}
function moveToDiscard(state, command, revision, reason) {
    const moved = moveHandCard(state, command.playerId, command.payload.cardInstanceId, "DISCARD_PILE");
    const discarded = {
        type: "CARD_DISCARDED",
        commandId: command.commandId,
        playerId: command.playerId,
        cardInstanceId: command.payload.cardInstanceId,
        reason,
        revision,
    };
    const phase = command.commandType === "DISCARD_OVERFLOW"
        ? moved.nextHands[command.playerId].length > state.ruleset.handLimit ? "TURN_START" : "ACTION_SELECTION"
        : "TURN_END";
    return {
        state: {
            ...state,
            phase,
            revision,
            cardZones: moved.nextZones,
            players: moved.nextPlayers,
            cardInstances: moved.nextCardInstances,
            pendingAction: null,
            pendingAttack: null,
            respondingPlayerId: null,
        },
        events: [discarded],
    };
}
function moveTimeoutCardToDiscard(state, command, revision) {
    const hand = state.cardZones.hands[command.playerId];
    if (hand.length === 0) {
        return {
            state: { ...state, phase: "TURN_END", revision, pendingAction: null, respondingPlayerId: null },
            events: [],
        };
    }
    const cardInstanceId = hand[hand.length - 1];
    const moved = moveHandCard(state, command.playerId, cardInstanceId, "DISCARD_PILE");
    const discarded = {
        type: "CARD_DISCARDED",
        commandId: command.commandId,
        playerId: command.playerId,
        cardInstanceId,
        reason: "TIMEOUT",
        revision,
    };
    return {
        state: {
            ...state,
            phase: "TURN_END",
            revision,
            cardZones: moved.nextZones,
            players: moved.nextPlayers,
            cardInstances: moved.nextCardInstances,
            pendingAction: null,
            pendingAttack: null,
            respondingPlayerId: null,
        },
        events: [discarded],
    };
}
function finishBySurrender(state, command, revision) {
    const otherPlayerId = state.initialPlayerOrder.find((playerId) => playerId !== command.playerId) ?? null;
    const terminalFlags = {
        ...state.terminalFlags,
        defeatedPlayerIds: [command.playerId],
        endKind: "SURRENDER",
        battleWinnerId: otherPlayerId,
        divineSelectionWinnerId: null,
    };
    const finished = { type: "MATCH_FINISHED", endKind: "SURRENDER", revision };
    return {
        state: {
            ...state,
            phase: "FINISHED",
            activePlayerId: null,
            revision,
            pendingAction: null,
            pendingAttack: null,
            respondingPlayerId: null,
            terminalFlags,
            judgment: null,
        },
        events: [finished],
    };
}
function answerResponse(state, command, revision) {
    const pending = state.pendingAction;
    if (!pending || pending.kind !== "RESPONSE_SELECTION")
        throw new Error("response command without pending response action");
    let nextState = state;
    let responseCardInstanceId = null;
    let responseMode = "ACCEPT_DAMAGE";
    const events = [];
    if (command.commandType === "SELECT_RESPONSE") {
        const moved = moveHandCard(state, command.playerId, command.payload.cardInstanceId, "RESOLUTION");
        nextState = { ...state, cardZones: moved.nextZones, players: moved.nextPlayers, cardInstances: moved.nextCardInstances };
        responseCardInstanceId = command.payload.cardInstanceId;
        responseMode = command.payload.responseMode;
    }
    const cardResolution = {
        kind: "CARD_RESOLUTION",
        pendingActionId: `pending.${pending.commandId}`,
        commandId: pending.commandId,
        playerId: pending.attackingPlayerId,
        cardInstanceId: pending.cardInstanceId,
        cardDefinitionId: pending.cardDefinitionId,
        playMode: pending.playMode,
        targetPlayerId: pending.targetPlayerId,
        discardCardInstanceId: null,
        responseCardInstanceId,
        responseMode,
    };
    const responseEvent = {
        type: "RESPONSE_ACCEPTED",
        commandId: command.commandId,
        playerId: command.playerId,
        responseKind: responseMode,
        revision,
    };
    events.push(responseEvent);
    return {
        state: {
            ...nextState,
            phase: "RESOLUTION",
            revision,
            pendingAction: cardResolution,
            respondingPlayerId: null,
        },
        events,
    };
}
export function applyCommand(state, input, options = {}) {
    const validation = validateCommand(state, input, options);
    if (validation.ok === false) {
        const commandId = validation.error.commandId;
        return {
            accepted: false,
            replayed: false,
            state,
            events: [{ type: "COMMAND_REJECTED", commandId, reasonCode: validation.error.code, revision: state.revision }],
            error: validation.error,
        };
    }
    if (validation.kind === "REPLAY") {
        return {
            accepted: true,
            replayed: true,
            state,
            events: validation.replay.events,
            revisionBefore: state.revision,
            revisionAfter: state.revision,
        };
    }
    const command = validation.command;
    const revisionBefore = state.revision;
    const revisionAfter = revisionBefore + 1;
    let nextState = { ...state, revision: revisionAfter };
    let events = [acceptedEvent(command.commandId, revisionAfter)];
    switch (command.commandType) {
        case "PLAY_CARD": {
            const result = moveToResolution(nextState, command, revisionAfter);
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
        case "DISCARD_FOR_ACTION": {
            const result = moveToDiscard(nextState, command, revisionAfter, "ACTION");
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
        case "DISCARD_OVERFLOW": {
            const result = moveToDiscard(nextState, command, revisionAfter, "OVERFLOW");
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
        case "TIMEOUT_DEFAULT_ACTION": {
            const result = moveTimeoutCardToDiscard(nextState, command, revisionAfter);
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
        case "SELECT_RESPONSE":
        case "ACCEPT_DAMAGE": {
            const result = answerResponse(nextState, command, revisionAfter);
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
        case "SURRENDER": {
            const result = finishBySurrender(nextState, command, revisionAfter);
            nextState = result.state;
            events = [...events, ...result.events];
            break;
        }
    }
    const historyEntry = {
        command,
        revisionBefore,
        revisionAfter,
        events,
    };
    nextState = {
        ...nextState,
        commandHistory: { ...state.commandHistory, [command.commandId]: historyEntry },
    };
    assertGameState(nextState);
    return {
        accepted: true,
        replayed: false,
        state: nextState,
        events,
        revisionBefore,
        revisionAfter,
    };
}
export function openResponseSelection(state, pending) {
    if (state.phase !== "RESOLUTION")
        throw new Error("response selection can only open from RESOLUTION");
    if (state.pendingAction?.kind !== "CARD_RESOLUTION")
        throw new Error("no card resolution is pending");
    const nextState = {
        ...state,
        phase: "RESPONSE_SELECTION",
        respondingPlayerId: pending.defendingPlayerId,
        pendingAction: pending,
    };
    assertGameState(nextState);
    return nextState;
}
