import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_12_CARD_DEFINITIONS,
  createAlpha12Setup,
  enumerateAlpha12CpuActions,
  executeAlpha12Command,
  generateAlpha12CpuLegalCommands,
  initial12CommandValidationOptions,
  materializeAlpha12CpuCommand,
} from "../../packages/content/src/index.ts";
import {
  ALPHA_12_RULESET,
  projectPublicState,
  validateCommand,
} from "../../packages/game-core/src/index.ts";

const baseSetup = createAlpha12Setup({
  matchId: "p4-01-cpu-legal-actions",
  seed: "123456789abcdef00fedcba987654321",
  playerIds: ["P1", "P2"],
});

function oneCardPerDefinition(state) {
  return INITIAL_12_CARD_DEFINITIONS.map((definition) => {
    const card = Object.values(state.cardInstances).find((candidate) => candidate.cardDefinitionId === definition.cardDefinitionId);
    assert.ok(card, `fixture card for ${definition.cardDefinitionId}`);
    return card.cardInstanceId;
  });
}

function cardsOutside(state, excluded, count) {
  const excludedSet = new Set(excluded);
  return Object.keys(state.cardInstances).filter((cardId) => !excludedSet.has(cardId)).slice(0, count);
}

function withHands(state, p1Hand, p2Hand, options = {}) {
  const p1 = [...p1Hand];
  const p2 = [...p2Hand];
  const p1Set = new Set(p1);
  const p2Set = new Set(p2);
  assert.equal(p1Set.size, p1.length);
  assert.equal(p2Set.size, p2.length);
  assert.equal([...p1Set].some((cardId) => p2Set.has(cardId)), false);

  const allCardIds = Object.keys(state.cardInstances);
  const drawPile = allCardIds.filter((cardId) => !p1Set.has(cardId) && !p2Set.has(cardId));
  const cardInstances = Object.fromEntries(allCardIds.map((cardId) => {
    const card = state.cardInstances[cardId];
    const ownerPlayerId = p1Set.has(cardId) ? "P1" : p2Set.has(cardId) ? "P2" : card.ownerPlayerId;
    const zone = p1Set.has(cardId) || p2Set.has(cardId) ? "HAND" : "DRAW_PILE";
    return [cardId, { ...card, ownerPlayerId, zone }];
  }));
  const ruleset = options.ruleset ?? state.ruleset;
  const phase = options.phase ?? "ACTION_SELECTION";
  const next = {
    ...state,
    ruleset,
    phase,
    activePlayerId: options.activePlayerId ?? "P1",
    respondingPlayerId: options.respondingPlayerId ?? null,
    pendingAction: options.pendingAction ?? null,
    pendingAttack: options.pendingAttack ?? null,
    activeField: options.activeField ?? null,
    world: {
      ...state.world,
      durability: options.worldDurability ?? 80,
    },
    players: {
      ...state.players,
      P1: {
        ...state.players.P1,
        hitPoints: options.p1HitPoints ?? 30,
        worldDamageResponsibility: options.p1Responsibility ?? 0,
        hand: p1,
      },
      P2: {
        ...state.players.P2,
        hitPoints: options.p2HitPoints ?? 30,
        worldDamageResponsibility: options.p2Responsibility ?? 5,
        hand: p2,
      },
    },
    cardZones: {
      ...state.cardZones,
      drawPile,
      hands: { P1: p1, P2: p2 },
      discardPile: [],
      revealedCards: [],
      inResolution: [],
    },
    cardInstances,
  };
  return next;
}

function publicState(state, playerId) {
  const projected = projectPublicState(state, { kind: "PLAYER", playerId });
  assert.equal(projected.ok, true);
  if (!projected.ok) throw new Error("fixture projection failed");
  return projected.state;
}

function actionKey(action) {
  return JSON.stringify(action);
}

test("P4-01 enumerates all public legal action choices without timeout fallback", () => {
  const cards = oneCardPerDefinition(baseSetup.state);
  const state = withHands(baseSetup.state, cards, cardsOutside(baseSetup.state, cards, 2), {
    activeField: {
      fieldDefinitionId: "field.frenzied-fracture.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
    },
  });
  const view = publicState(state, "P1");
  const actions = enumerateAlpha12CpuActions(view, "P1");

  assert.ok(actions.some((action) => action.commandType === "PLAY_CARD" && action.payload.playMode === "RELEASE"));
  assert.ok(actions.some((action) => action.commandType === "PLAY_CARD" && action.payload.playMode === "RESTRAIN"));
  assert.equal(actions.filter((action) => action.commandType === "DISCARD_FOR_ACTION").length, cards.length);
  assert.equal(actions.filter((action) => action.commandType === "SURRENDER").length, 1);
  assert.equal(actions.some((action) => action.commandType === "TIMEOUT_DEFAULT_ACTION"), false);

  const redrawActions = actions.filter((action) => (
    action.commandType === "PLAY_CARD"
    && action.payload.cardInstanceId === cards[11]
    && action.payload.playMode === "RELEASE"
  ));
  assert.equal(redrawActions.length, cards.length - 1, "careful-redraw must enumerate every other own card");
  assert.equal(new Set(actions.map(actionKey)).size, actions.length);
  assert.deepEqual(actions, enumerateAlpha12CpuActions(view, "P1"), "ordering must be deterministic");
});

test("P4-01 materializes commands that the production validator and executor accept", () => {
  const cards = oneCardPerDefinition(baseSetup.state);
  const state = withHands(baseSetup.state, cards, cardsOutside(baseSetup.state, cards, 2), {
    activeField: {
      fieldDefinitionId: "field.root-sanctuary.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
    },
  });
  const commands = generateAlpha12CpuLegalCommands(state, "P1");

  assert.equal(commands.length, new Set(commands.map((command) => command.commandId)).size);
  assert.ok(commands.every((command, index) => command.expectedRevision === state.revision && command.commandId.endsWith(`a${String(index + 1).padStart(4, "0")}`)));
  for (const command of commands) {
    const validation = validateCommand(state, command, initial12CommandValidationOptions);
    assert.equal(validation.ok, true, `${command.commandType} should be accepted: ${JSON.stringify(validation)}`);
    const execution = executeAlpha12Command(state, command);
    assert.equal(execution.accepted, true, `${command.commandType} should execute`);
  }
});

test("P4-01 response and overflow phases expose only their legal inputs", () => {
  const cards = oneCardPerDefinition(baseSetup.state);
  const starBreaker = cards[1];
  const responseCards = [cards[3], cards[4], cards[5]];
  const actionState = withHands(baseSetup.state, [starBreaker], responseCards);
  const actionView = publicState(actionState, "P1");
  const attackAction = enumerateAlpha12CpuActions(actionView, "P1").find((action) => (
    action.commandType === "PLAY_CARD" && action.payload.cardInstanceId === starBreaker && action.payload.playMode === "RELEASE"
  ));
  assert.ok(attackAction);
  const attackCommand = materializeAlpha12CpuCommand(attackAction, actionState.revision, "p4-01-attack");
  const responseExecution = executeAlpha12Command(actionState, attackCommand);
  assert.equal(responseExecution.accepted, true);
  const responseView = publicState(responseExecution.state, "P2");
  const responseActions = enumerateAlpha12CpuActions(responseView, "P2");
  assert.equal(responseActions.filter((action) => action.commandType === "SELECT_RESPONSE").length, responseCards.length);
  assert.equal(responseActions.filter((action) => action.commandType === "ACCEPT_DAMAGE").length, 1);
  assert.equal(responseActions.filter((action) => action.commandType === "SURRENDER").length, 1);
  assert.equal(responseActions.some((action) => action.commandType === "PLAY_CARD"), false);

  const overflowState = withHands(baseSetup.state, [baseSetup.state.cardZones.hands.P1[0], baseSetup.state.cardZones.hands.P1[1]], [], {
    phase: "TURN_START",
    ruleset: { ...ALPHA_12_RULESET, handLimit: 1 },
  });
  const overflowActions = enumerateAlpha12CpuActions(publicState(overflowState, "P1"), "P1");
  assert.deepEqual(overflowActions.map((action) => action.commandType), ["DISCARD_OVERFLOW", "DISCARD_OVERFLOW"]);
});

test("P4-01 legal action output is unchanged by hidden hand, deck, seed, RNG, and history differences", () => {
  const cards = oneCardPerDefinition(baseSetup.state);
  const state = withHands(baseSetup.state, cards, cardsOutside(baseSetup.state, cards, 2), {
    activeField: {
      fieldDefinitionId: "field.frenzied-fracture.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
    },
  });
  const variant = {
    ...state,
    seed: "fedcba98765432100123456789abcdef",
    randomConsumptionCount: state.randomConsumptionCount + 1,
    commandHistory: {
      hidden: { command: { secret: true }, revisionBefore: 0, revisionAfter: 0, events: [] },
    },
    players: {
      ...state.players,
      P2: { ...state.players.P2, hand: [...state.players.P2.hand].reverse() },
    },
    cardZones: {
      ...state.cardZones,
      drawPile: [...state.cardZones.drawPile].reverse(),
      hands: { ...state.cardZones.hands, P2: [...state.cardZones.hands.P2].reverse() },
    },
  };
  const firstView = publicState(state, "P1");
  const secondView = publicState(variant, "P1");
  assert.deepEqual(secondView, firstView);
  assert.deepEqual(enumerateAlpha12CpuActions(secondView, "P1"), enumerateAlpha12CpuActions(firstView, "P1"));
  assert.deepEqual(generateAlpha12CpuLegalCommands(variant, "P1"), generateAlpha12CpuLegalCommands(state, "P1"));
});
