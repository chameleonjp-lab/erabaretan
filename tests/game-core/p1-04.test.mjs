import test from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_12_RULESET,
  applyCommand,
  calculateStateHash,
  createReplayRecord,
  createInitialGameState,
  createDeterministicRng,
  hashGameState,
  replayCommands,
  sha256Hex,
  verifyReplay,
} from "../../packages/game-core/src/index.ts";
import { canonicalJson } from "../../packages/game-core/src/hash/state-hash.ts";
import {
  createAlpha12Setup,
  executeAlpha12Command,
} from "../../packages/content/src/index.ts";

const seed = "123456789abcdef00fedcba987654321";

function card(cardInstanceId, cardDefinitionId, ownerPlayerId, zone, drawOrder) {
  return { cardInstanceId, cardDefinitionId, ownerPlayerId, zone, drawOrder };
}

function fixtureState() {
  return createInitialGameState({
    matchId: "match-p1-04",
    catalogHash: "catalog.alpha-12.v1",
    engineVersion: "game-core.alpha-12.v1",
    rngAlgorithmVersion: "rng.xoshiro128ss.v1",
    shuffleAlgorithmVersion: "shuffle.fisher-yates-desc.v1",
    seed,
    ruleset: ALPHA_12_RULESET,
    players: [
      { playerId: "P1", hand: ["p1-card-01"] },
      { playerId: "P2", hand: ["p2-card-01"] },
    ],
    firstPlayerId: "P1",
    cardInstances: [
      card("p1-card-01", "attack.steadfast-strike.v1", "P1", "HAND", 1),
      card("p2-card-01", "attack.steadfast-strike.v1", "P2", "HAND", 2),
      card("draw-01", "attack.rift-pebble.v1", "P1", "DRAW_PILE", 3),
    ],
    drawPile: ["draw-01"],
  });
}

test("xoshiro128ss nextUint32 and nextInt match the fixed vectors", () => {
  const uints = createDeterministicRng(seed);
  assert.deepEqual(
    Array.from({ length: 12 }, () => uints.nextUint32().toString(16).padStart(8, "0")),
    ["99981812", "66666962", "d3905550", "309cbe4f", "06991cb1", "4ef39f2d", "1f6bc67b", "8d5d51c5", "a6091973", "f2e9a317", "270cb834", "3f5a171f"],
  );
  assert.equal(uints.randomConsumptionCount, 12);

  const ints = createDeterministicRng(seed);
  assert.deepEqual(Array.from({ length: 12 }, () => ints.nextInt(10)), [2, 2, 0, 3, 9, 5, 9, 7, 5, 1, 2, 7]);
  assert.equal(ints.randomConsumptionCount, 12);
});

test("rejection sampling and five-element shuffle consume the specified values", () => {
  const rejected = createDeterministicRng(seed);
  assert.deepEqual(Array.from({ length: 4 }, () => rejected.nextInt(2_147_483_649)), [1717987682, 815578703, 110697649, 1324588845]);
  assert.equal(rejected.randomConsumptionCount, 6);

  const shuffled = createDeterministicRng(seed);
  const values = ["A", "B", "C", "D", "E"];
  for (let index = values.length - 1; index >= 1; index -= 1) {
    const swapIndex = shuffled.nextInt(index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  assert.deepEqual(values, ["A", "D", "B", "E", "C"]);
  assert.equal(shuffled.randomConsumptionCount, 4);
});

test("alpha-12 setup matches the fixed hands, draw pile, first player, and count", () => {
  const setup = createAlpha12Setup({ matchId: "setup-p1-04", seed });
  assert.deepEqual(setup.hands, {
    P1: [
      "attack.rift-pebble.v1#02",
      "intervention.judgment-of-scars.v1#01",
      "attack.star-breaker.v1#01",
      "intervention.careful-redraw.v1#01",
      "field.frenzied-fracture.v1#01",
      "intervention.verdant-bargain.v1#02",
      "intervention.judgment-of-scars.v1#03",
    ],
    P2: [
      "field.frenzied-fracture.v1#02",
      "field.root-sanctuary.v1#02",
      "intervention.oath-of-renewal.v1#01",
      "attack.star-breaker.v1#02",
      "intervention.field-nullification.v1#01",
      "field.root-sanctuary.v1#03",
      "attack.steadfast-strike.v1#01",
    ],
  });
  assert.deepEqual(setup.drawPile.slice(0, 10), [
    "attack.steadfast-strike.v1#03",
    "intervention.verdant-bargain.v1#03",
    "defense.ashen-bulwark.v1#03",
    "intervention.oath-of-renewal.v1#03",
    "intervention.careful-redraw.v1#03",
    "attack.rift-pebble.v1#01",
    "defense.guardian-veil.v1#03",
    "field.root-sanctuary.v1#01",
    "intervention.field-nullification.v1#02",
    "intervention.careful-redraw.v1#02",
  ]);
  assert.deepEqual(setup.drawPile.slice(-3), [
    "defense.ashen-bulwark.v1#02",
    "defense.guardian-veil.v1#01",
    "intervention.field-nullification.v1#03",
  ]);
  assert.equal(setup.firstPlayerId, "P2");
  assert.equal(setup.randomConsumptionCount, 36);
  assert.equal(Object.keys(setup.state.cardInstances).length, 36);
});

test("canonical JSON uses code-point key order and pure SHA-256", () => {
  assert.equal(canonicalJson({ "\uE000": 1, "\u{10000}": 2 }), "{\"\":1,\"𐀀\":2}");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("state hash changes for game facts but ignores command history", () => {
  const state = fixtureState();
  const original = hashGameState(state);
  const withHistory = { ...state, commandHistory: { unrelated: { command: { displayText: "演出" }, revisionBefore: 0, revisionAfter: 1, events: [] } } };
  assert.equal(hashGameState(withHistory), original);
  assert.equal(calculateStateHash(state), original);
  assert.notEqual(hashGameState({ ...state, randomConsumptionCount: 1 }), original);
  assert.notEqual(hashGameState({ ...state, players: { ...state.players, P1: { ...state.players.P1, hitPoints: 29 } } }), original);
  assert.notEqual(hashGameState({ ...state, players: { ...state.players, P1: { ...state.players.P1, hand: ["draw-01", "p1-card-01"] } }, cardZones: { ...state.cardZones, hands: { ...state.cardZones.hands, P1: ["draw-01", "p1-card-01"] } } }), original);
  assert.notEqual(hashGameState({ ...state, cardZones: { ...state.cardZones, drawPile: [] } }), original);
  assert.notEqual(hashGameState({ ...state, players: { ...state.players, P1: { ...state.players.P1, worldDamageResponsibility: 1 } } }), original);
  assert.notEqual(hashGameState({ ...state, world: { ...state.world, triggeredThresholds: [75] } }), original);
});

test("replay verifies accepted commands and rejects invalid or duplicate input", () => {
  const initial = fixtureState();
  const command = {
    commandId: "replay-command-001",
    playerId: "P1",
    expectedRevision: 0,
    commandType: "DISCARD_FOR_ACTION",
    payload: { cardInstanceId: "p1-card-01" },
  };
  const applied = applyCommand(initial, command);
  assert.equal(applied.accepted, true);
  if (!applied.accepted) return;
  const replay = createReplayRecord(initial, [command], applied.state, { expectedRevisions: [1] });
  const verified = verifyReplay(initial, replay);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.finalStateHash, hashGameState(applied.state));
  assert.equal(replayCommands(initial, replay).ok, true);

  const duplicate = verifyReplay(initial, {
    ...replay,
    acceptedCommands: [command, command],
    expectedRevisions: [1, 1],
    expectedRandomConsumptionCounts: [0, 0],
    expectedStateHashes: [replay.expectedStateHashes[0], replay.expectedStateHashes[0]],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, "REPLAY_DUPLICATE_COMMAND");

  const invalid = verifyReplay(initial, { ...replay, acceptedCommands: [{ ...command, payload: { cardInstanceId: "missing" } }] });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "REPLAY_COMMAND_REJECTED");
  assert.throws(() => createReplayRecord(initial, [{ ...command, payload: { cardInstanceId: "missing" } }], applied.state), /cannot create replay record/);
  const randomMismatch = verifyReplay(initial, { ...replay, expectedRandomConsumptionCounts: [1] });
  assert.equal(randomMismatch.ok, false);
  if (!randomMismatch.ok) {
    assert.equal(randomMismatch.code, "REPLAY_RANDOM_CONSUMPTION_MISMATCH");
    assert.equal(randomMismatch.commandIndex, 0);
  }
  const missingSnapshots = verifyReplay(initial, { ...replay, expectedRandomConsumptionCounts: undefined });
  assert.equal(missingSnapshots.ok, false);
  if (!missingSnapshots.ok) assert.equal(missingSnapshots.code, "REPLAY_RANDOM_CONSUMPTION_MISMATCH");
  assert.equal(initial.randomConsumptionCount, 0);
});

test("alpha-12 replay uses the same command/effect pipeline through normal defeat", () => {
  const setup = createAlpha12Setup({ matchId: "golden-g01-normal-defeat", seed });
  const drawn = "attack.steadfast-strike.v1#03";
  const used = "attack.steadfast-strike.v1#01";
  const p2Hand = [...setup.state.players.P2.hand, drawn];
  const prepared = {
    ...setup.state,
    players: {
      ...setup.state.players,
      P1: { ...setup.state.players.P1, hitPoints: 6 },
      P2: { ...setup.state.players.P2, hand: p2Hand },
    },
    cardZones: {
      ...setup.state.cardZones,
      drawPile: setup.state.cardZones.drawPile.slice(1),
      hands: { ...setup.state.cardZones.hands, P2: p2Hand },
    },
    cardInstances: {
      ...setup.state.cardInstances,
      [drawn]: { ...setup.state.cardInstances[drawn], ownerPlayerId: "P2", zone: "HAND" },
    },
  };
  const firstCommand = {
    commandId: "g01-command-001",
    playerId: "P2",
    expectedRevision: 0,
    commandType: "PLAY_CARD",
    payload: { cardInstanceId: used, playMode: "RELEASE", targetPlayerId: "P1" },
  };
  const secondCommand = {
    commandId: "g01-command-002",
    playerId: "P1",
    expectedRevision: 1,
    commandType: "ACCEPT_DAMAGE",
    payload: {},
  };
  const first = executeAlpha12Command(prepared, firstCommand);
  assert.equal(first.accepted, true);
  assert.equal(first.state.phase, "RESPONSE_SELECTION");
  const second = executeAlpha12Command(first.state, secondCommand);
  assert.equal(second.accepted, true);
  assert.equal(second.state.phase, "FINISHED");
  assert.deepEqual(second.state.judgment?.playerScores, { P1: 2, P2: 72 });
  assert.deepEqual(second.state.cardZones.revealedCards, [used]);

  const commands = [firstCommand, secondCommand];
  const expectedEventTypes = [...first.events, ...second.events].map((event) => event.type);
  const replay = createReplayRecord(prepared, commands, second.state, {
    executeCommand: executeAlpha12Command,
    expectedEventTypes,
  });
  assert.deepEqual(replay.expectedRandomConsumptionCounts, [36, 36]);
  assert.deepEqual(replay.expectedRevisions, [1, 2]);
  const verified = verifyReplay(prepared, replay, { executeCommand: executeAlpha12Command });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.state.phase, "FINISHED");
    assert.equal(verified.finalStateHash, hashGameState(second.state));
  }
  const internalEffectCommand = executeAlpha12Command(prepared, {
    commandId: "g01-internal-effect-001",
    playerId: "P2",
    expectedRevision: 0,
    commandType: "GOLDEN_EFFECT_QUEUE_RESOLVE",
    payload: {},
  });
  assert.equal(internalEffectCommand.accepted, false);
});
