import type { CommandValidationOptions } from "../../../game-core/src/commands/validate.ts";
import type { Command } from "../../../game-core/src/commands/types.ts";
import {
  applyCommand,
  advanceToNextTurnStart,
  beginPendingAttack,
  openResponseSelection,
  resolveEffectQueue,
  type CardResolutionAction,
  type GameState,
  type ReplayCommandExecution,
} from "../../../game-core/src/index.ts";
import { INITIAL_12_CARD_BY_ID, buildInitial12CardEffects, initial12CommandValidationOptions } from "../cards/initial-12.ts";

function moveResolvedCards(state: GameState, cardInstanceIds: readonly string[]): GameState {
  const ids = cardInstanceIds.filter((cardInstanceId, index) => cardInstanceIds.indexOf(cardInstanceId) === index);
  const inResolution = state.cardZones.inResolution.filter((cardInstanceId) => !ids.includes(cardInstanceId));
  const discardPile = [...state.cardZones.discardPile];
  const revealedCards = [...state.cardZones.revealedCards];
  const cardInstances = { ...state.cardInstances };
  for (const cardInstanceId of ids) {
    if (!state.cardZones.inResolution.includes(cardInstanceId)) continue;
    if (!discardPile.includes(cardInstanceId)) discardPile.push(cardInstanceId);
    if (!revealedCards.includes(cardInstanceId)) revealedCards.push(cardInstanceId);
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
  } as GameState;
  return phase === "FINISHED" ? nextState : advanceToNextTurnStart(nextState);
}

function firstAttackDamage(effects: readonly { readonly commandType: string; readonly payload: unknown }[]): number | null {
  const damage = effects.find((effect) => effect.commandType === "DAMAGE_PLAYER");
  if (!damage || typeof damage.payload !== "object" || damage.payload === null) return null;
  const amount = (damage.payload as { readonly amount?: unknown }).amount;
  return typeof amount === "number" ? amount : null;
}

function buildCardEffects(state: GameState, action: CardResolutionAction) {
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
  });
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
      })
    : [];
  const responseModifiers = responseEffects.filter((effect) => (
    effect.commandType === "ADD_SHIELD"
    || effect.commandType === "REDUCE_INCOMING_DAMAGE"
    || effect.executionTiming === "AFTER_RESPONSE_MODIFIERS"
  ));
  const responseWorldEffects = responseEffects.filter((effect) => !responseModifiers.includes(effect));
  return [...responseModifiers, ...attackEffects, ...responseWorldEffects];
}

function resolveCardResolution(state: GameState): { readonly state: GameState; readonly events: readonly { readonly type: string }[] } {
  const action = state.pendingAction;
  if (!action || action.kind !== "CARD_RESOLUTION") return { state, events: [] };
  const effects = buildCardEffects(state, action);
  const result = resolveEffectQueue(state, effects);
  if (!result.committed) return { state: result.state, events: result.events };
  const cards = [action.cardInstanceId];
  if (action.responseCardInstanceId) cards.push(action.responseCardInstanceId);
  return { state: moveResolvedCards(result.state, cards), events: result.events };
}

function openAttackResponse(state: GameState): GameState {
  const action = state.pendingAction;
  if (!action || action.kind !== "CARD_RESOLUTION") return state;
  const definition = INITIAL_12_CARD_BY_ID[action.cardDefinitionId];
  if (!definition || definition.role !== "ATTACK" || action.playMode !== "RELEASE" || !action.targetPlayerId) return state;
  const effects = buildInitial12CardEffects({
    resolutionId: action.pendingActionId,
    cardDefinitionId: action.cardDefinitionId,
    cardInstanceId: action.cardInstanceId,
    ownerPlayerId: action.playerId,
    targetPlayerId: action.targetPlayerId,
    mode: action.playMode,
    turnSequence: state.turnSequence,
  });
  const baseDamage = firstAttackDamage(effects);
  if (baseDamage === null) return state;
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

export function executeAlpha12Command(
  state: GameState,
  command: Command,
  validationOptions: CommandValidationOptions = initial12CommandValidationOptions,
): ReplayCommandExecution {
  const result = applyCommand(state, command, validationOptions);
  if (!result.accepted || result.replayed) return result;

  let nextState = result.state;
  let events: readonly { readonly type: string }[] = result.events;
  if (command.commandType === "PLAY_CARD" && nextState.pendingAction?.kind === "CARD_RESOLUTION") {
    const definition = INITIAL_12_CARD_BY_ID[nextState.pendingAction.cardDefinitionId];
    if (definition?.role === "ATTACK" && nextState.pendingAction.playMode === "RELEASE" && nextState.pendingAction.targetPlayerId) {
      nextState = openAttackResponse(nextState);
    } else {
      const resolved = resolveCardResolution(nextState);
      nextState = resolved.state;
      events = [...events, ...resolved.events];
    }
  } else if ((command.commandType === "SELECT_RESPONSE" || command.commandType === "ACCEPT_DAMAGE") && nextState.pendingAction?.kind === "CARD_RESOLUTION") {
    const resolved = resolveCardResolution(nextState);
    nextState = resolved.state;
    events = [...events, ...resolved.events];
  }
  return { ...result, state: nextState, events };
}
