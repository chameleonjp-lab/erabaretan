import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGameState,
  hashGameState,
  projectPublicState,
  resolveEffectQueue,
  summarizeMatch,
} from "../../packages/game-core/src/index.ts";
import {
  createAlpha12Setup,
  executeAlpha12Command,
  previewAlpha12Command,
} from "../../packages/content/src/index.ts";

const seed = "123456789abcdef00fedcba987654321";

function setupState(matchId) {
  return createAlpha12Setup({ matchId, seed, playerIds: ["P1", "P2"] }).state;
}

function accepted(result) {
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error(result.error.message);
  return result;
}

function play(commandId, playerId, expectedRevision, cardInstanceId, targetPlayerId, playMode = "RELEASE") {
  return {
    commandId,
    playerId,
    expectedRevision,
    commandType: "PLAY_CARD",
    payload: {
      cardInstanceId,
      playMode,
      ...(targetPlayerId ? { targetPlayerId } : {}),
    },
  };
}

function acceptDamage(commandId, playerId, expectedRevision) {
  return {
    commandId,
    playerId,
    expectedRevision,
    commandType: "ACCEPT_DAMAGE",
    payload: {},
  };
}

function surrender(commandId, playerId, expectedRevision) {
  return {
    commandId,
    playerId,
    expectedRevision,
    commandType: "SURRENDER",
    payload: {},
  };
}

function cardInHand(state, playerId, cardDefinitionId) {
  const cardInstanceId = state.cardZones.hands[playerId].find(
    (id) => state.cardInstances[id].cardDefinitionId === cardDefinitionId,
  );
  assert.ok(cardInstanceId, `${playerId} must have ${cardDefinitionId} in the deterministic fixture`);
  return cardInstanceId;
}

function physicalCardIds(state) {
  return [
    ...state.cardZones.drawPile,
    ...state.cardZones.discardPile,
    ...state.cardZones.inResolution,
    ...Object.values(state.cardZones.hands).flat(),
  ];
}

function assertCardLedger(state) {
  const physical = physicalCardIds(state);
  const declared = Object.keys(state.cardInstances);
  assert.equal(physical.length, declared.length, "physical card count must be conserved");
  assert.equal(new Set(physical).size, physical.length, "a card instance must not occupy two physical zones");
  assert.deepEqual([...physical].sort(), [...declared].sort(), "every card instance must remain in a physical zone");
}

function hiddenStateVariant(state) {
  const hiddenHand = [...state.cardZones.hands.P2].reverse();
  return {
    ...state,
    seed: "fedcba98765432100123456789abcdef",
    randomConsumptionCount: state.randomConsumptionCount + 1,
    players: {
      ...state.players,
      P2: { ...state.players.P2, hand: hiddenHand },
    },
    cardZones: {
      ...state.cardZones,
      hands: { ...state.cardZones.hands, P2: hiddenHand },
    },
    commandHistory: {
      ...state.commandHistory,
      "hidden-state-marker": {
        command: { hidden: true },
        revisionBefore: 0,
        revisionAfter: 0,
        events: [],
      },
    },
  };
}

function systemRevealEffect(ordinal) {
  return {
    effectId: `effect.p2-03-budget.${String(ordinal).padStart(4, "0")}`,
    commandType: "REVEAL_PUBLIC_INFORMATION",
    source: { sourceKind: "SYSTEM", ownerPlayerId: null, mode: "SYSTEM" },
    target: { targetKind: "PUBLIC_INFORMATION" },
    payload: { informationKind: "CARD_PLAYED" },
    attributionPolicy: "NO_LEDGER",
    executionTiming: "IMMEDIATE",
  };
}

function assertRejectedWithoutMutation(state, command, code) {
  const before = structuredClone(state);
  const result = executeAlpha12Command(state, command);
  assert.equal(result.accepted, false);
  assert.strictEqual(result.state, state);
  assert.deepEqual(result.state, before);
  assert.equal(result.error.code, code);
  assert.deepEqual(result.events.map((event) => event.type), ["COMMAND_REJECTED"]);
  assert.equal(result.events[0].reasonCode, code);
  assert.equal(result.events[0].revision, state.revision);
}

test("P2-03 invariants reject duplicate zones, out-of-range values, and broken phase relationships", () => {
  const state = setupState("p2-03-invariant-rejections");
  const cardInstanceId = state.cardZones.hands.P1[0];

  assert.throws(
    () => assertGameState({
      ...state,
      cardZones: { ...state.cardZones, drawPile: [cardInstanceId, ...state.cardZones.drawPile] },
    }),
    /multiple or no zones/,
  );
  assert.throws(
    () => assertGameState({
      ...state,
      players: { ...state.players, P1: { ...state.players.P1, hitPoints: -1 } },
    }),
    /P1\.hitPoints/,
  );
  assert.throws(
    () => assertGameState({ ...state, world: { ...state.world, durability: 101 } }),
    /world\.durability/,
  );
  assert.throws(
    () => assertGameState({ ...state, world: { ...state.world, triggeredThresholds: [50, 75] } }),
    /descending trigger order/,
  );
  assert.throws(
    () => assertGameState({ ...state, phase: "RESPONSE_SELECTION" }),
    /RESPONSE_SELECTION requires/,
  );
});

test("P2-03 accepted transitions preserve the physical card ledger and bounded values", () => {
  let state = { ...setupState("p2-03-ledger"), activePlayerId: "P1" };
  assertGameState(state);
  assertCardLedger(state);

  const attackCard = cardInHand(state, "P1", "attack.rift-pebble.v1");
  const played = accepted(executeAlpha12Command(state, play("p2-03-ledger-play", "P1", state.revision, attackCard, "P2")));
  state = played.state;
  assertGameState(state);
  assertCardLedger(state);
  assert.equal(state.phase, "RESPONSE_SELECTION");
  assert.equal(state.effectQueue.length, 0);

  const resolved = accepted(executeAlpha12Command(state, acceptDamage("p2-03-ledger-accept", "P2", state.revision)));
  state = resolved.state;
  assertGameState(state);
  assertCardLedger(state);
  assert.equal(state.effectQueue.length, 0);
  for (const player of Object.values(state.players)) {
    assert.ok(player.hitPoints >= 0 && player.hitPoints <= player.maxHitPoints);
  }
  assert.ok(state.world.durability >= 0 && state.world.durability <= state.world.maxDurability);
});

test("P2-03 effect queue accepts the declared maximum and marks an over-budget queue invalid", () => {
  const state = setupState("p2-03-effect-budget");
  const withinLimit = resolveEffectQueue(
    state,
    Array.from({ length: state.ruleset.maxEffectsPerResolution }, (_, index) => systemRevealEffect(index + 1)),
  );
  assert.equal(withinLimit.committed, true);
  assert.equal(withinLimit.state.phase, state.phase);
  assert.deepEqual(withinLimit.state.effectQueue, []);
  assert.equal(withinLimit.results.length, state.ruleset.maxEffectsPerResolution);
  assertGameState(withinLimit.state);

  const overLimit = resolveEffectQueue(
    state,
    Array.from({ length: state.ruleset.maxEffectsPerResolution + 1 }, (_, index) => systemRevealEffect(index + 1)),
  );
  assert.equal(overLimit.committed, false);
  assert.equal(overLimit.rejectionCode, "EFFECT_QUEUE_LIMIT");
  assert.equal(overLimit.state.phase, "FINISHED");
  assert.equal(overLimit.state.terminalFlags.endKind, "INVALID_MATCH");
  assertGameState(overLimit.state);
  const summary = summarizeMatch(overLimit.state);
  assert.equal(summary.ok, true);
  if (summary.ok) {
    assert.equal(summary.summary.battle.status, "VOID");
    assert.equal(summary.summary.scoreStatus, "NOT_AWARDED");
    assert.equal(summary.summary.divineSelection.status, "NOT_AWARDED");
  }
});

test("P2-03 FINISHED state is immutable and accepted command replay is idempotent", () => {
  const state = { ...setupState("p2-03-finished-immutable"), activePlayerId: "P1" };
  const command = surrender("p2-03-surrender", "P1", state.revision);
  const finished = accepted(executeAlpha12Command(state, command));
  assert.equal(finished.state.phase, "FINISHED");
  assert.equal(finished.state.terminalFlags.endKind, "SURRENDER");
  assertGameState(finished.state);

  const before = structuredClone(finished.state);
  assertRejectedWithoutMutation(
    finished.state,
    surrender("p2-03-after-finished", "P1", finished.state.revision),
    "MATCH_FINISHED",
  );
  assert.deepEqual(finished.state, before);

  const replay = executeAlpha12Command(finished.state, command);
  assert.equal(replay.accepted, true);
  if (replay.accepted) {
    assert.equal(replay.replayed, true);
    assert.strictEqual(replay.state, finished.state);
    assert.deepEqual(replay.state, before);
  }
});

test("P2-03 public projection hides every opponent hand and secret engine field", () => {
  const state = { ...setupState("p2-03-public-secrets"), activePlayerId: "P1" };
  const own = projectPublicState(state, { kind: "PLAYER", playerId: "P1" });
  const opponent = projectPublicState(state, { kind: "PLAYER", playerId: "P2" });
  const spectator = projectPublicState(state, { kind: "SPECTATOR" });
  assert.equal(own.ok, true);
  assert.equal(opponent.ok, true);
  assert.equal(spectator.ok, true);
  if (!own.ok || !opponent.ok || !spectator.ok) return;

  assert.equal(own.state.players[1].hand.cards, null);
  assert.equal(spectator.state.players[0].hand.cards, null);
  assert.equal(spectator.state.players[1].hand.cards, null);
  assert.equal(opponent.state.players[0].hand.cards, null);
  assert.equal(opponent.state.players[1].hand.cards?.length, state.players.P2.hand.length);

  const serializedOwn = JSON.stringify(own.state);
  const serializedSpectator = JSON.stringify(spectator.state);
  for (const secretField of ["seed", "drawOrder", "randomConsumptionCount", "commandHistory", "effectQueue"]) {
    assert.equal(Object.hasOwn(own.state, secretField), false, `public state must not expose ${secretField}`);
    assert.equal(serializedOwn.includes(`"${secretField}"`), false, `serialized state must not expose ${secretField}`);
  }
  for (const cardInstanceId of state.players.P2.hand) {
    assert.equal(serializedOwn.includes(cardInstanceId), false, `opponent card leaked: ${cardInstanceId}`);
    assert.equal(serializedSpectator.includes(cardInstanceId), false, `spectator card leaked: ${cardInstanceId}`);
  }
});

test("P2-03 public projection is identical when only hidden state changes", () => {
  const state = { ...setupState("p2-03-public-stability"), activePlayerId: "P1" };
  const variant = hiddenStateVariant(state);
  assert.notEqual(hashGameState(state), hashGameState(variant), "the hidden variants must be different authoritative states");

  for (const viewer of [
    { kind: "PLAYER", playerId: "P1" },
    { kind: "SPECTATOR" },
  ]) {
    assert.deepEqual(projectPublicState(state, viewer), projectPublicState(variant, viewer));
  }
});

test("P2-03 response projection does not reveal which defense card the opponent can use", () => {
  const state = { ...setupState("p2-03-response-secrecy"), activePlayerId: "P1" };
  const attackCard = cardInHand(state, "P1", "attack.rift-pebble.v1");
  const pending = accepted(executeAlpha12Command(state, play("p2-03-response-attack", "P1", state.revision, attackCard, "P2"))).state;
  assert.equal(pending.phase, "RESPONSE_SELECTION");
  const publicState = projectPublicState(pending, { kind: "PLAYER", playerId: "P1" });
  const hiddenVariant = hiddenStateVariant(pending);
  const variantPublicState = projectPublicState(hiddenVariant, { kind: "PLAYER", playerId: "P1" });
  assert.deepEqual(publicState, variantPublicState);
  assert.equal(publicState.ok, true);
  if (!publicState.ok) return;
  assert.equal(publicState.state.pendingInteraction?.kind, "RESPONSE_SELECTION");
  assert.equal(publicState.state.players[1].hand.cards, null);
  const serialized = JSON.stringify(publicState.state);
  for (const cardInstanceId of pending.players.P2.hand) {
    assert.equal(serialized.includes(cardInstanceId), false, `response card leaked: ${cardInstanceId}`);
  }
});

test("P2-03 preview is pure and unchanged by hidden hand, seed, history, or random-count differences", () => {
  const state = { ...setupState("p2-03-preview-secrecy"), activePlayerId: "P1" };
  const variant = hiddenStateVariant(state);
  const discardCard = state.players.P1.hand[0];
  const attackCard = cardInHand(state, "P1", "attack.rift-pebble.v1");
  const intents = [
    {
      commandType: "DISCARD_FOR_ACTION",
      playerId: "P1",
      payload: { cardInstanceId: discardCard },
    },
    {
      commandType: "PLAY_CARD",
      playerId: "P1",
      payload: { cardInstanceId: attackCard, playMode: "RELEASE", targetPlayerId: "P2" },
    },
  ];

  const before = JSON.stringify(state);
  const beforeHash = hashGameState(state);
  for (const intent of intents) {
    const preview = previewAlpha12Command(state, { kind: "PLAYER", playerId: "P1" }, intent);
    const variantPreview = previewAlpha12Command(variant, { kind: "PLAYER", playerId: "P1" }, intent);
    assert.deepEqual(preview, variantPreview);
    assert.notEqual(preview.status, "UNAVAILABLE");
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(hashGameState(state), beforeHash);
});

test("P2-03 final summary is unchanged by hidden hand information", () => {
  let state = { ...setupState("p2-03-summary-secrecy"), activePlayerId: "P1" };
  const attackCard = cardInHand(state, "P1", "attack.rift-pebble.v1");
  state = {
    ...state,
    players: { ...state.players, P2: { ...state.players.P2, hitPoints: 4 } },
  };
  assertGameState(state);
  const played = accepted(executeAlpha12Command(state, play("p2-03-summary-attack", "P1", state.revision, attackCard, "P2")));
  const finished = accepted(executeAlpha12Command(played.state, acceptDamage("p2-03-summary-accept", "P2", played.state.revision))).state;
  assert.equal(finished.phase, "FINISHED");
  const variant = hiddenStateVariant(finished);
  assert.deepEqual(summarizeMatch(finished), summarizeMatch(variant));
  assert.deepEqual(
    projectPublicState(finished, { kind: "PLAYER", playerId: "P1" }),
    projectPublicState(variant, { kind: "PLAYER", playerId: "P1" }),
  );
});
