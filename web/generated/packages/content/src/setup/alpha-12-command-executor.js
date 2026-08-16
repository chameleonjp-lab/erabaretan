import { applyCommand, advanceToNextTurnStart, beginPendingAttack, openResponseSelection, resolveEffectQueue, } from "../../../game-core/src/index.js";
import { INITIAL_12_CATALOG, buildInitial12CardEffects, initial12CommandValidationOptions, } from "../cards/initial-12.js";
function moveResolvedCards(state, cardInstanceIds) {
    const ids = cardInstanceIds.filter((cardInstanceId, index) => cardInstanceIds.indexOf(cardInstanceId) === index);
    const inResolution = state.cardZones.inResolution.filter((cardInstanceId) => !ids.includes(cardInstanceId));
    const discardPile = [...state.cardZones.discardPile];
    const revealedCards = [...state.cardZones.revealedCards];
    const cardInstances = { ...state.cardInstances };
    for (const cardInstanceId of ids) {
        if (!state.cardZones.inResolution.includes(cardInstanceId))
            continue;
        if (!discardPile.includes(cardInstanceId))
            discardPile.push(cardInstanceId);
        if (!revealedCards.includes(cardInstanceId))
            revealedCards.push(cardInstanceId);
        cardInstances[cardInstanceId] = { ...cardInstances[cardInstanceId], zone: "DISCARD_PILE" };
    }
    const phase = state.phase === "FINISHED" ? "FINISHED" : "TURN_END";
    const nextState = {
        ...state,
        phase,
        pendingAction: null,
        pendingAttack: null,
        respondingPlayerId: null,
        effectQueue: [],
        cardZones: { ...state.cardZones, inResolution, discardPile, revealedCards },
        cardInstances,
    };
    return phase === "FINISHED" ? nextState : advanceToNextTurnStart(nextState);
}
function firstAttackDamage(effects) {
    const damage = effects.find((effect) => effect.commandType === "DAMAGE_PLAYER");
    if (!damage || typeof damage.payload !== "object" || damage.payload === null)
        return null;
    const amount = damage.payload.amount;
    return typeof amount === "number" ? amount : null;
}
function buildCardEffects(state, action, catalog) {
    const attackEffects = buildInitial12CardEffects({
        resolutionId: action.pendingActionId,
        cardDefinitionId: action.cardDefinitionId,
        cardInstanceId: action.cardInstanceId,
        ownerPlayerId: action.playerId,
        targetPlayerId: action.targetPlayerId ?? undefined,
        pendingAttackId: state.pendingAttack?.pendingAttackId,
        discardCardInstanceId: action.discardCardInstanceId ?? undefined,
        mode: action.playMode,
        turnSequence: state.turnSequence,
    }, catalog);
    const responseEffects = action.responseCardInstanceId && action.responseMode === "RESPONSE"
        ? buildInitial12CardEffects({
            resolutionId: `${action.pendingActionId}.response`,
            cardDefinitionId: state.cardInstances[action.responseCardInstanceId].cardDefinitionId,
            cardInstanceId: action.responseCardInstanceId,
            ownerPlayerId: state.cardInstances[action.responseCardInstanceId].ownerPlayerId,
            targetPlayerId: action.playerId,
            pendingAttackId: state.pendingAttack?.pendingAttackId,
            mode: "RESPONSE",
            turnSequence: state.turnSequence,
        }, catalog)
        : [];
    const responseModifiers = responseEffects.filter((effect) => (effect.commandType === "ADD_SHIELD"
        || effect.commandType === "REDUCE_INCOMING_DAMAGE"
        || effect.executionTiming === "AFTER_RESPONSE_MODIFIERS"));
    const responseWorldEffects = responseEffects.filter((effect) => !responseModifiers.includes(effect));
    return [...responseModifiers, ...attackEffects, ...responseWorldEffects];
}
function resolveCardResolution(state, catalog) {
    const action = state.pendingAction;
    if (!action || action.kind !== "CARD_RESOLUTION")
        return { state, events: [] };
    const effects = buildCardEffects(state, action, catalog);
    const result = resolveEffectQueue(state, effects);
    if (!result.committed)
        return { state: result.state, events: result.events };
    const cards = [action.cardInstanceId];
    if (action.responseCardInstanceId)
        cards.push(action.responseCardInstanceId);
    return { state: moveResolvedCards(result.state, cards), events: result.events };
}
function openAttackResponse(state, catalog) {
    const action = state.pendingAction;
    if (!action || action.kind !== "CARD_RESOLUTION")
        return state;
    const definition = catalog.byId[action.cardDefinitionId];
    if (!definition || definition.role !== "ATTACK" || action.playMode !== "RELEASE" || !action.targetPlayerId)
        return state;
    const effects = buildInitial12CardEffects({
        resolutionId: action.pendingActionId,
        cardDefinitionId: action.cardDefinitionId,
        cardInstanceId: action.cardInstanceId,
        ownerPlayerId: action.playerId,
        targetPlayerId: action.targetPlayerId,
        mode: action.playMode,
        turnSequence: state.turnSequence,
    }, catalog);
    const baseDamage = firstAttackDamage(effects);
    if (baseDamage === null)
        return state;
    const pendingAttackId = `attack.${action.commandId}`;
    const withAttack = beginPendingAttack(state, {
        pendingAttackId,
        attackingPlayerId: action.playerId,
        defendingPlayerId: action.targetPlayerId,
        baseDamage,
    });
    return openResponseSelection(withAttack, {
        kind: "RESPONSE_SELECTION",
        pendingAttackId,
        commandId: action.commandId,
        attackingPlayerId: action.playerId,
        defendingPlayerId: action.targetPlayerId,
        cardInstanceId: action.cardInstanceId,
        cardDefinitionId: action.cardDefinitionId,
        playMode: action.playMode,
        targetPlayerId: action.targetPlayerId,
    });
}
export function executeAlpha12Command(state, command, validationOptions = initial12CommandValidationOptions, catalog = INITIAL_12_CATALOG) {
    const result = applyCommand(state, command, validationOptions);
    if (!result.accepted || result.replayed)
        return result;
    let nextState = result.state;
    let events = result.events;
    if (command.commandType === "PLAY_CARD" && nextState.pendingAction?.kind === "CARD_RESOLUTION") {
        const definition = catalog.byId[nextState.pendingAction.cardDefinitionId];
        if (definition?.role === "ATTACK" && nextState.pendingAction.playMode === "RELEASE" && nextState.pendingAction.targetPlayerId) {
            nextState = openAttackResponse(nextState, catalog);
        }
        else {
            const resolved = resolveCardResolution(nextState, catalog);
            nextState = resolved.state;
            events = [...events, ...resolved.events];
        }
    }
    else if ((command.commandType === "SELECT_RESPONSE" || command.commandType === "ACCEPT_DAMAGE") && nextState.pendingAction?.kind === "CARD_RESOLUTION") {
        const resolved = resolveCardResolution(nextState, catalog);
        nextState = resolved.state;
        events = [...events, ...resolved.events];
    }
    return { ...result, state: nextState, events };
}
