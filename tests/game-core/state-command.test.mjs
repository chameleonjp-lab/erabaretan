import test from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_12_RULESET,
  applyCommand,
  beginPendingAttack,
  createInitialGameState,
  openResponseSelection,
  validateCommand,
} from "../../packages/game-core/src/index.ts";

const card = (cardInstanceId, cardDefinitionId, ownerPlayerId, zone, drawOrder) => ({
  cardInstanceId,
  cardDefinitionId,
  ownerPlayerId,
  zone,
  drawOrder,
});

function makeState(overrides = {}) {
  return createInitialGameState({
    matchId: "match-p1-01",
    catalogHash: "catalog.alpha-12.v1",
    engineVersion: "game-core.alpha-12.v1",
    rngAlgorithmVersion: "rng.xoshiro128ss.v1",
    shuffleAlgorithmVersion: "shuffle.fisher-yates-desc.v1",
    seed: "123456789abcdef00fedcba987654321",
    ruleset: ALPHA_12_RULESET,
    players: [
      { playerId: "P1", hand: ["p1-steadfast-01", "p1-rift-01"] },
      { playerId: "P2", hand: ["p2-filler-01"] },
    ],
    firstPlayerId: "P1",
    cardInstances: [
      card("p1-steadfast-01", "attack.steadfast-strike.v1", "P1", "HAND", 1),
      card("p1-rift-01", "attack.rift-pebble.v1", "P1", "HAND", 2),
      card("p2-filler-01", "attack.steadfast-strike.v1", "P2", "HAND", 3),
      card("draw-01", "attack.star-breaker.v1", "P1", "DRAW_PILE", 4),
    ],
    drawPile: ["draw-01"],
    ...overrides,
  });
}

function command(commandId, commandType, payload, expectedRevision = 0, playerId = "P1") {
  return { commandId, playerId, expectedRevision, commandType, payload };
}

test("createInitialGameState builds aligned player hands and card zones", () => {
  const state = makeState();
  assert.equal(state.phase, "ACTION_SELECTION");
  assert.deepEqual(state.players.P1.hand, state.cardZones.hands.P1);
  assert.equal(state.world.durability, 100);
  assert.equal(state.revision, 0);
});

test("PLAY_CARD is a pure structural transition into RESOLUTION", () => {
  const result = applyCommand(stateOrThrow(makeState()), command(
    "cmd-play-001",
    "PLAY_CARD",
    { cardInstanceId: "p1-steadfast-01", playMode: "RELEASE", targetPlayerId: "P2" },
  ));
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.state.phase, "RESOLUTION");
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.state.players.P1.hand, ["p1-rift-01"]);
  assert.deepEqual(result.state.cardZones.inResolution, ["p1-steadfast-01"]);
  assert.equal(result.state.pendingAction?.kind, "CARD_RESOLUTION");
  assert.deepEqual(result.events.map((event) => event.type), ["COMMAND_ACCEPTED", "CARD_PLAYED"]);
});

test("stale revisions are rejected without changing the state", () => {
  const state = makeState();
  const result = applyCommand(state, command(
    "cmd-stale-001",
    "DISCARD_FOR_ACTION",
    { cardInstanceId: "p1-rift-01" },
    4,
  ));
  assert.equal(result.accepted, false);
  assert.equal(result.state, state);
  assert.equal(result.error.code, "STALE_REVISION");
  assert.deepEqual(result.events.map((event) => event.type), ["COMMAND_REJECTED"]);
});

test("an accepted command is idempotent and different reuse is rejected", () => {
  const state = makeState();
  const first = applyCommand(state, command(
    "cmd-replay-001",
    "DISCARD_FOR_ACTION",
    { cardInstanceId: "p1-rift-01" },
  ));
  assert.equal(first.accepted, true);
  if (!first.accepted) return;
  const replay = applyCommand(first.state, command(
    "cmd-replay-001",
    "DISCARD_FOR_ACTION",
    { cardInstanceId: "p1-rift-01" },
    0,
  ));
  assert.equal(replay.accepted, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, first.state);
  assert.equal(replay.revisionAfter, 1);

  const conflict = applyCommand(first.state, command(
    "cmd-replay-001",
    "DISCARD_FOR_ACTION",
    { cardInstanceId: "p1-steadfast-01" },
    1,
  ));
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.error.code, "COMMAND_ID_REUSE");
  assert.equal(conflict.state, first.state);
});

test("RESOLUTION rejects surrender and never lets a client interrupt effects", () => {
  const state = makeState();
  const played = applyCommand(state, command(
    "cmd-resolution-001",
    "PLAY_CARD",
    { cardInstanceId: "p1-steadfast-01", playMode: "RELEASE", targetPlayerId: "P2" },
  ));
  assert.equal(played.accepted, true);
  if (!played.accepted) return;
  const result = applyCommand(played.state, command("cmd-resolution-surrender", "SURRENDER", {}, 1, "P1"));
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "RESOLUTION_IN_PROGRESS");
  assert.equal(result.state, played.state);
});

test("response selection accepts one response and returns to RESOLUTION", () => {
  const played = applyCommand(makeState(), command(
    "cmd-attack-001",
    "PLAY_CARD",
    { cardInstanceId: "p1-steadfast-01", playMode: "RELEASE", targetPlayerId: "P2" },
  ));
  assert.equal(played.accepted, true);
  if (!played.accepted) return;
  const responseState = openResponseSelection(beginPendingAttack(played.state, {
    pendingAttackId: "pending.cmd-attack-001",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    baseDamage: 3,
  }), {
    kind: "RESPONSE_SELECTION",
    pendingAttackId: "pending.cmd-attack-001",
    commandId: "cmd-attack-001",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    cardInstanceId: "p1-steadfast-01",
    cardDefinitionId: "attack.steadfast-strike.v1",
    playMode: "RELEASE",
    targetPlayerId: "P2",
  });
  const response = applyCommand(responseState, command(
    "cmd-response-001",
    "ACCEPT_DAMAGE",
    {},
    1,
    "P2",
  ));
  assert.equal(response.accepted, true);
  if (!response.accepted) return;
  assert.equal(response.state.phase, "RESOLUTION");
  assert.equal(response.state.pendingAction?.kind, "CARD_RESOLUTION");
  assert.equal(response.state.pendingAction?.responseMode, "ACCEPT_DAMAGE");
  assert.deepEqual(response.events.map((event) => event.type), ["COMMAND_ACCEPTED", "RESPONSE_ACCEPTED"]);
});

test("timeout default action discards the newest card deterministically", () => {
  const result = applyCommand(makeState(), command(
    "cmd-timeout-001",
    "TIMEOUT_DEFAULT_ACTION",
    {},
  ));
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.deepEqual(result.state.cardZones.discardPile, ["p1-rift-01"]);
  assert.equal(result.state.phase, "TURN_END");
  assert.equal(result.events.at(-1)?.type, "CARD_DISCARDED");
});

test("command validation rejects an opponent action and effect values from the client", () => {
  const state = makeState();
  const wrongPlayer = validateCommand(state, command(
    "cmd-wrong-player-001",
    "DISCARD_FOR_ACTION",
    { cardInstanceId: "p2-filler-01" },
    0,
    "P2",
  ));
  assert.equal(wrongPlayer.ok, false);
  if (!wrongPlayer.ok) assert.equal(wrongPlayer.error.code, "NOT_ACTIVE_PLAYER");

  const clientEffect = validateCommand(state, command(
    "cmd-client-effect-001",
    "PLAY_CARD",
    { cardInstanceId: "p1-steadfast-01", playMode: "RELEASE", targetPlayerId: "P2", amount: 999 },
  ));
  assert.equal(clientEffect.ok, false);
  if (!clientEffect.ok) assert.equal(clientEffect.error.code, "INVALID_PAYLOAD");
});

test("state construction rejects a card whose owner does not match its hand", () => {
  assert.throws(
    () => makeState({
      cardInstances: [
        card("p1-steadfast-01", "attack.steadfast-strike.v1", "P2", "HAND", 1),
        card("p1-rift-01", "attack.rift-pebble.v1", "P1", "HAND", 2),
        card("p2-filler-01", "attack.steadfast-strike.v1", "P2", "HAND", 3),
        card("draw-01", "attack.star-breaker.v1", "P1", "DRAW_PILE", 4),
      ],
    }),
    /owned by P2/,
  );
});

function stateOrThrow(state) {
  return state;
}
