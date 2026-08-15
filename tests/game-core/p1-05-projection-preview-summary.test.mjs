import test from "node:test";
import assert from "node:assert/strict";
import {
  beginPendingAttack,
  assertGameState,
  hashGameState,
  previewCommand,
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

function prepareG01() {
  const setup = createAlpha12Setup({ matchId: "p1-05-g01", seed });
  const drawn = "attack.steadfast-strike.v1#03";
  const used = "attack.steadfast-strike.v1#01";
  const hand = [...setup.state.players.P2.hand, drawn];
  return {
    state: {
      ...setup.state,
      players: {
        ...setup.state.players,
        P1: { ...setup.state.players.P1, hitPoints: 6 },
        P2: { ...setup.state.players.P2, hand },
      },
      cardZones: {
        ...setup.state.cardZones,
        drawPile: setup.state.cardZones.drawPile.slice(1),
        hands: { ...setup.state.cardZones.hands, P2: hand },
      },
      cardInstances: {
        ...setup.state.cardInstances,
        [drawn]: { ...setup.state.cardInstances[drawn], ownerPlayerId: "P2", zone: "HAND" },
      },
    },
    used,
  };
}

function preparedEffectState(matchId, worldDurability, p1Hp, p2Hp) {
  const state = createAlpha12Setup({ matchId, seed }).state;
  return {
    ...state,
    phase: "RESOLUTION",
    activePlayerId: null,
    revision: 1,
    players: {
      ...state.players,
      P1: { ...state.players.P1, hitPoints: p1Hp },
      P2: { ...state.players.P2, hitPoints: p2Hp },
    },
    world: { ...state.world, durability: worldDurability, triggeredThresholds: [] },
  };
}

function cardSource() {
  return {
    sourceKind: "CARD",
    ownerPlayerId: "P1",
    cardDefinitionId: "attack.rift-pebble.v1",
    cardInstanceId: "attack.rift-pebble.v1#02",
    mode: "RELEASE",
  };
}

function worldCollapseEffects() {
  const source = cardSource();
  return [
    {
      effectId: "effect.p1-05-g02.0001",
      commandType: "DAMAGE_PLAYER",
      source,
      target: { targetKind: "PLAYER", playerId: "P2" },
      payload: { amount: 30, damageKind: "DIRECT" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "IMMEDIATE",
    },
    {
      effectId: "effect.p1-05-g02.0002",
      commandType: "DAMAGE_WORLD",
      source,
      target: { targetKind: "WORLD" },
      payload: { amount: 80, reason: "CARD_RELEASE" },
      attributionPolicy: "SOURCE_OWNER",
      executionTiming: "IMMEDIATE",
    },
  ];
}

function simultaneousReflectionEffects() {
  const source = cardSource();
  return [
    {
      effectId: "effect.p1-05-g03.0001",
      commandType: "DAMAGE_PLAYER",
      source,
      target: { targetKind: "PLAYER", playerId: "P2" },
      payload: { amount: 10, damageKind: "DIRECT" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "AFTER_RESPONSE_MODIFIERS",
    },
    {
      effectId: "effect.p1-05-g03.0002",
      commandType: "REFLECT_DAMAGE",
      source,
      target: { targetKind: "PLAYER", playerId: "P1" },
      payload: { amount: 10, pendingAttackId: "p1-05-g03-attack" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "IMMEDIATE",
    },
    {
      effectId: "effect.p1-05-g03.0003",
      commandType: "DAMAGE_WORLD",
      source,
      target: { targetKind: "WORLD" },
      payload: { amount: 30, reason: "CARD_RELEASE" },
      attributionPolicy: "SOURCE_OWNER",
      executionTiming: "IMMEDIATE",
    },
  ];
}

test("public state exposes only the viewer's hand and safe public zones", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-public", seed }).state;
  const own = projectPublicState(state, { kind: "PLAYER", playerId: "P1" });
  const opponent = projectPublicState(state, { kind: "PLAYER", playerId: "P2" });
  const spectator = projectPublicState(state, { kind: "SPECTATOR" });

  assert.equal(own.ok, true);
  assert.equal(opponent.ok, true);
  assert.equal(spectator.ok, true);
  if (!own.ok || !opponent.ok || !spectator.ok) return;

  assert.deepEqual(own.state.players[0].hand.cards, state.cardZones.hands.P1.map((cardInstanceId) => ({
    cardInstanceId,
    cardDefinitionId: state.cardInstances[cardInstanceId].cardDefinitionId,
  })));
  assert.equal(own.state.players[0].hand.count, state.cardZones.hands.P1.length);
  assert.equal(own.state.players[1].hand.cards, null);
  assert.equal(opponent.state.players[0].hand.cards, null);
  assert.equal(opponent.state.players[1].hand.cards?.length, state.cardZones.hands.P2.length);
  assert.equal(spectator.state.players[0].hand.cards, null);
  assert.equal(spectator.state.players[1].hand.cards, null);
  assert.equal(own.state.drawPileCount, state.cardZones.drawPile.length);
  assert.deepEqual(own.state.discardPile, []);
  assert.deepEqual(own.state.revealedCards, []);
  assert.deepEqual(own.state.inResolution, []);

  const serialized = JSON.stringify(own.state);
  for (const forbidden of ["seed", "drawOrder", "randomConsumptionCount", "commandHistory", "effectQueue"]) {
    assert.equal(Object.hasOwn(own.state, forbidden), false, `public state must not expose ${forbidden}`);
    assert.equal(serialized.includes(`"${forbidden}"`), false, `serialized public state must not expose ${forbidden}`);
  }
});

test("public projection is stable when only hidden state changes", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-secrecy", seed }).state;
  const hiddenHand = [...state.cardZones.hands.P2].reverse();
  const secretVariant = {
    ...state,
    seed: "fedcba98765432100123456789abcdef",
    randomConsumptionCount: state.randomConsumptionCount + 1,
    commandHistory: {
      hidden: {
        command: { secret: true },
        revisionBefore: 0,
        revisionAfter: 0,
        events: [],
      },
    },
    players: { ...state.players, P2: { ...state.players.P2, hand: hiddenHand } },
    cardZones: { ...state.cardZones, hands: { ...state.cardZones.hands, P2: hiddenHand } },
  };
  const first = projectPublicState(state, { kind: "PLAYER", playerId: "P1" });
  const second = projectPublicState(secretVariant, { kind: "PLAYER", playerId: "P1" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second);
});

test("revealed history cannot turn a physical hand card into a revealed zone", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-revealed-invariant", seed }).state;
  const cardInstanceId = state.cardZones.hands.P1[0];
  const invalid = {
    ...state,
    cardZones: { ...state.cardZones, revealedCards: [cardInstanceId] },
    cardInstances: {
      ...state.cardInstances,
      [cardInstanceId]: { ...state.cardInstances[cardInstanceId], zone: "REVEALED" },
    },
  };
  assert.throws(() => assertGameState(invalid), /zone mismatch/);
});

test("preview is pure, returns the production delta, and normalizes card probing", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-preview", seed }).state;
  const playerId = state.activePlayerId;
  assert.ok(playerId);
  const cardInstanceId = state.cardZones.hands[playerId][0];
  const intent = {
    commandType: "DISCARD_FOR_ACTION",
    playerId,
    payload: { cardInstanceId },
  };
  const before = JSON.stringify(state);
  const beforeHash = hashGameState(state);
  const preview = previewAlpha12Command(state, { kind: "PLAYER", playerId }, intent);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;

  const command = {
    commandId: "p1-05-preview-real",
    expectedRevision: state.revision,
    ...intent,
  };
  const actual = executeAlpha12Command(state, command);
  assert.equal(actual.accepted, true);
  assert.equal(preview.basedOnRevision, state.revision);
  assert.equal(preview.delta.handCountDeltas[playerId], actual.state.cardZones.hands[playerId].length - state.cardZones.hands[playerId].length);
  assert.equal(preview.delta.phaseAfter, actual.state.phase);
  assert.equal(preview.delta.wouldFinishMatch, actual.state.phase === "FINISHED");
  assert.equal(JSON.stringify(state), before);
  assert.equal(hashGameState(state), beforeHash);

  const otherPlayerId = state.initialPlayerOrder.find((id) => id !== playerId);
  const opponentCard = state.cardZones.hands[otherPlayerId][0];
  const missingCard = "attack.rift-pebble.v1#99";
  const unavailable = (card) => previewAlpha12Command(state, { kind: "PLAYER", playerId }, {
    commandType: "DISCARD_FOR_ACTION",
    playerId,
    payload: { cardInstanceId: card },
  });
  assert.deepEqual(unavailable(opponentCard), {
    status: "REJECTED",
    basedOnRevision: state.revision,
    code: "CARD_UNAVAILABLE",
  });
  assert.deepEqual(unavailable(missingCard), {
    status: "REJECTED",
    basedOnRevision: state.revision,
    code: "CARD_UNAVAILABLE",
  });
  assert.deepEqual(previewAlpha12Command(state, { kind: "SPECTATOR" }, intent), {
    status: "REJECTED",
    basedOnRevision: state.revision,
    code: "VIEWER_NOT_PLAYER",
  });
});

test("preview isolates a destructive executor from the authoritative state", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-preview-isolation", seed }).state;
  const playerId = state.activePlayerId;
  assert.ok(playerId);
  const cardInstanceId = state.cardZones.hands[playerId][0];
  const intent = {
    commandType: "DISCARD_FOR_ACTION",
    playerId,
    payload: { cardInstanceId },
  };
  const before = JSON.stringify(state);
  const beforeHash = hashGameState(state);
  const result = previewCommand(
    state,
    { kind: "PLAYER", playerId },
    intent,
    (workingState, command) => {
      workingState.cardInstances[cardInstanceId].zone = "DISCARD_PILE";
      workingState.cardZones.inResolution.push(cardInstanceId);
      workingState.pendingAttack = {
        pendingAttackId: "destructive",
        attackingPlayerId: playerId,
        defendingPlayerId: state.initialPlayerOrder.find((id) => id !== playerId),
        baseDamage: 1,
        responseCount: 0,
        incomingDamageReduction: 0,
        currentShield: 0,
        effectiveDamage: null,
        reflectionApplied: false,
      };
      return { accepted: true, replayed: false, state: workingState, events: [] };
    },
  );
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(JSON.stringify(state), before);
  assert.equal(hashGameState(state), beforeHash);
});

test("attack preview is partial and does not disclose response information", () => {
  const fixture = prepareG01();
  const intent = {
    commandType: "PLAY_CARD",
    playerId: "P2",
    payload: { cardInstanceId: fixture.used, playMode: "RELEASE", targetPlayerId: "P1" },
  };
  const preview = previewAlpha12Command(fixture.state, { kind: "PLAYER", playerId: "P2" }, intent);
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  assert.equal(preview.certainty, "PARTIAL");
  assert.deepEqual(preview.uncertainties, ["OPPONENT_RESPONSE"]);
  assert.equal(preview.delta.playerHitPointDeltas.P1, 0);
  assert.equal(preview.delta.phaseAfter, "RESPONSE_SELECTION");
  assert.equal(typeof preview.pendingAttackBaseDamage, "number");
  assert.equal(JSON.stringify(preview).includes("defense"), false);
  assert.equal(JSON.stringify(preview).includes("cardInstanceId"), false);
  assert.equal(JSON.stringify(preview).includes("responseCardInstanceId"), false);
});

test("normal summaries preserve G01, G02, and G03 judgment facts", () => {
  const g01 = prepareG01();
  const first = executeAlpha12Command(g01.state, {
    commandId: "p1-05-g01-001",
    playerId: "P2",
    expectedRevision: 0,
    commandType: "PLAY_CARD",
    payload: { cardInstanceId: g01.used, playMode: "RELEASE", targetPlayerId: "P1" },
  });
  const second = executeAlpha12Command(first.state, {
    commandId: "p1-05-g01-002",
    playerId: "P1",
    expectedRevision: 1,
    commandType: "ACCEPT_DAMAGE",
    payload: {},
  });
  const g01Summary = summarizeMatch(second.state);
  assert.equal(g01Summary.ok, true);
  if (!g01Summary.ok) return;
  assert.equal(g01Summary.summary.battle.winnerId, "P2");
  assert.equal(g01Summary.summary.divineSelection.winnerId, "P2");
  assert.deepEqual(g01Summary.summary.players.map((player) => player.score), [2, 72]);
  assert.deepEqual(g01Summary.summary.normalEndReasons, ["PLAYER_DEFEATED"]);

  const g02State = preparedEffectState("p1-05-g02", 80, 30, 30);
  const g02 = resolveEffectQueue(g02State, worldCollapseEffects());
  const g02Summary = summarizeMatch(g02.state);
  assert.equal(g02Summary.ok, true);
  if (!g02Summary.ok) return;
  assert.deepEqual(g02Summary.summary.players.map((player) => player.score), [-193, 2]);
  assert.deepEqual(g02Summary.summary.normalEndReasons, ["PLAYER_DEFEATED", "WORLD_COLLAPSED"]);

  let g03State = preparedEffectState("p1-05-g03", 30, 10, 10);
  g03State = beginPendingAttack(g03State, {
    pendingAttackId: "p1-05-g03-attack",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    baseDamage: 10,
  });
  const g03 = resolveEffectQueue(g03State, simultaneousReflectionEffects());
  const g03Summary = summarizeMatch(g03.state);
  assert.equal(g03Summary.ok, true);
  if (!g03Summary.ok) return;
  assert.equal(g03Summary.summary.battle.status, "DRAW");
  assert.equal(g03Summary.summary.divineSelection.winnerId, "P2");
  assert.deepEqual(g03Summary.summary.players.map((player) => player.score), [-113, 2]);
  assert.deepEqual(g03Summary.summary.normalEndReasons, ["PLAYER_DEFEATED", "WORLD_COLLAPSED"]);

  const inconsistent = {
    ...second.state,
    terminalFlags: { ...second.state.terminalFlags, defeatedPlayerIds: [] },
  };
  assert.deepEqual(summarizeMatch(inconsistent), { ok: false, code: "TERMINAL_STATE_INCONSISTENT" });
});

test("non-normal summaries do not award score or divine selection", () => {
  const state = createAlpha12Setup({ matchId: "p1-05-surrender", seed }).state;
  const surrenderingPlayerId = state.activePlayerId;
  assert.ok(surrenderingPlayerId);
  const result = executeAlpha12Command(state, {
    commandId: "p1-05-surrender-command",
    playerId: surrenderingPlayerId,
    expectedRevision: state.revision,
    commandType: "SURRENDER",
    payload: {},
  });
  assert.equal(result.accepted, true);
  const summary = summarizeMatch(result.state);
  assert.equal(summary.ok, true);
  if (!summary.ok) return;
  assert.equal(summary.summary.endKind, "SURRENDER");
  assert.equal(summary.summary.battle.status, "WINNER");
  assert.equal(summary.summary.scoreStatus, "NOT_AWARDED");
  assert.equal(summary.summary.divineSelection.status, "NOT_AWARDED");
  assert.deepEqual(summary.summary.players.map((player) => player.score), [null, null]);
  assert.deepEqual(summary.summary.players.map((player) => player.survivalEvaluation), [null, null]);

  const invalidWinner = {
    ...result.state,
    terminalFlags: { ...result.state.terminalFlags, battleWinnerId: null },
  };
  assert.deepEqual(summarizeMatch(invalidWinner), { ok: false, code: "TERMINAL_STATE_INCONSISTENT" });
  const invalidWorldFlag = {
    ...result.state,
    terminalFlags: { ...result.state.terminalFlags, worldCollapsed: true },
  };
  assert.deepEqual(summarizeMatch(invalidWorldFlag), { ok: false, code: "TERMINAL_STATE_INCONSISTENT" });
  const invalidRoundFlag = {
    ...result.state,
    terminalFlags: { ...result.state.terminalFlags, maxRoundsReached: true },
  };
  assert.deepEqual(summarizeMatch(invalidRoundFlag), { ok: false, code: "TERMINAL_STATE_INCONSISTENT" });
});
