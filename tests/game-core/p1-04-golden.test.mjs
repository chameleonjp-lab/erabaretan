import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  beginPendingAttack,
  hashGameState,
  resolveEffectQueue,
  serializeStateForHash,
} from "../../packages/game-core/src/index.ts";
import { createAlpha12Setup, executeAlpha12Command } from "../../packages/content/src/index.ts";

const seed = "123456789abcdef00fedcba987654321";

function standardSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function storedHashInput(name) {
  const content = readFileSync(new URL(`../fixtures/golden-alpha-12/${name}-state-hash-input.json`, import.meta.url), "utf8");
  assert.equal(content.endsWith("\n"), false, `${name} hash input fixture must not end with a newline`);
  return content;
}

const goldenManifest = JSON.parse(readFileSync(new URL("../fixtures/golden-alpha-12/golden-manifest.json", import.meta.url), "utf8"));

function prepareG01() {
  const setup = createAlpha12Setup({ matchId: "golden-g01-normal-defeat", seed });
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
    commands: [
      {
        commandId: "g01-command-001",
        playerId: "P2",
        expectedRevision: 0,
        commandType: "PLAY_CARD",
        payload: { cardInstanceId: used, playMode: "RELEASE", targetPlayerId: "P1" },
      },
      {
        commandId: "g01-command-002",
        playerId: "P1",
        expectedRevision: 1,
        commandType: "ACCEPT_DAMAGE",
        payload: {},
      },
    ],
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

test("G01 records revision hashes and a standard-SHA-256 final hash", () => {
  const fixture = prepareG01();
  const expected = goldenManifest.cases.g01;
  assert.equal(hashGameState(fixture.state), expected.initialStateHash);
  assert.deepEqual(fixture.commands, expected.input.commands);
  const first = executeAlpha12Command(fixture.state, fixture.commands[0]);
  assert.equal(first.accepted, true);
  assert.equal(first.state.randomConsumptionCount, 36);

  const second = executeAlpha12Command(first.state, fixture.commands[1]);
  assert.equal(second.accepted, true);
  assert.equal(second.state.phase, "FINISHED");
  assert.equal(second.state.revision, 2);
  assert.deepEqual(second.state.judgment?.playerScores, { P1: 2, P2: 72 });
  assert.deepEqual([...first.events, ...second.events].map((event) => event.type), expected.eventTypes);
  assert.deepEqual([first.state.revision, second.state.revision], expected.revisionSnapshots);
  assert.deepEqual([first.state.randomConsumptionCount, second.state.randomConsumptionCount], expected.randomConsumptionCounts);
  assert.deepEqual([hashGameState(first.state), hashGameState(second.state)], expected.stateHashes);
  const serialized = serializeStateForHash(second.state);
  assert.equal(serialized, storedHashInput("g01"));
  assert.equal(standardSha256(serialized), hashGameState(second.state));
  assert.equal(hashGameState(second.state), expected.finalStateHash);
});

test("G02 records world collapse, score, event order, and revision hash", () => {
  const expected = goldenManifest.cases.g02;
  const state = preparedEffectState("golden-g02-world-collapse", 80, 30, 30);
  const source = cardSource();
  const effects = [
    {
      effectId: "effect.g02.0001",
      commandType: "DAMAGE_PLAYER",
      source,
      target: { targetKind: "PLAYER", playerId: "P2" },
      payload: { amount: 30, damageKind: "DIRECT" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "IMMEDIATE",
    },
    {
      effectId: "effect.g02.0002",
      commandType: "DAMAGE_WORLD",
      source,
      target: { targetKind: "WORLD" },
      payload: { amount: 80, reason: "CARD_RELEASE" },
      attributionPolicy: "SOURCE_OWNER",
      executionTiming: "IMMEDIATE",
    },
  ];
  assert.equal(hashGameState(state), expected.initialStateHash);
  assert.equal(state.revision, expected.harnessBoundary.revisionBefore);
  assert.equal(expected.harnessBoundary.commandAcceptedEvent, false);
  assert.deepEqual(effects, expected.input.effects);
  const result = resolveEffectQueue(state, effects);
  assert.equal(result.committed, true);
  assert.equal(result.state.revision, expected.harnessBoundary.revisionAfter);
  assert.equal(result.state.terminalFlags.worldCollapsed, true);
  assert.deepEqual(result.state.judgment?.playerScores, { P1: -193, P2: 2 });
  assert.deepEqual(result.events.map((event) => event.type), expected.eventTypes);
  assert.deepEqual([result.state.revision], expected.revisionSnapshots);
  assert.deepEqual([result.state.randomConsumptionCount], expected.randomConsumptionCounts);
  assert.deepEqual([hashGameState(result.state)], expected.stateHashes);
  assert.equal(hashGameState(result.state), expected.finalStateHash);
  const serialized = serializeStateForHash(result.state);
  assert.equal(serialized, storedHashInput("g02"));
  assert.equal(standardSha256(serialized), expected.finalStateHash);
});

test("G03 records reflection, simultaneous defeat, and revision hash", () => {
  const expected = goldenManifest.cases.g03;
  let state = preparedEffectState("golden-g03-simultaneous-reflection", 30, 10, 10);
  state = beginPendingAttack(state, {
    pendingAttackId: "golden-g03-attack",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    baseDamage: 10,
  });
  const source = cardSource();
  const effects = [
    {
      effectId: "effect.g03.0001",
      commandType: "DAMAGE_PLAYER",
      source,
      target: { targetKind: "PLAYER", playerId: "P2" },
      payload: { amount: 10, damageKind: "DIRECT" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "AFTER_RESPONSE_MODIFIERS",
    },
    {
      effectId: "effect.g03.0002",
      commandType: "REFLECT_DAMAGE",
      source,
      target: { targetKind: "PLAYER", playerId: "P1" },
      payload: { amount: 10, pendingAttackId: "golden-g03-attack" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "IMMEDIATE",
    },
    {
      effectId: "effect.g03.0003",
      commandType: "DAMAGE_WORLD",
      source,
      target: { targetKind: "WORLD" },
      payload: { amount: 30, reason: "CARD_RELEASE" },
      attributionPolicy: "SOURCE_OWNER",
      executionTiming: "IMMEDIATE",
    },
  ];
  assert.equal(hashGameState(state), expected.initialStateHash);
  assert.equal(state.revision, expected.harnessBoundary.revisionBefore);
  assert.equal(expected.harnessBoundary.commandAcceptedEvent, false);
  assert.deepEqual(effects, expected.input.effects);
  const result = resolveEffectQueue(state, effects);
  assert.equal(result.committed, true);
  assert.equal(result.state.revision, expected.harnessBoundary.revisionAfter);
  assert.deepEqual(result.state.terminalFlags.defeatedPlayerIds, ["P1", "P2"]);
  assert.equal(result.state.terminalFlags.battleWinnerId, null);
  assert.deepEqual(result.state.judgment?.playerScores, { P1: -113, P2: 2 });
  assert.deepEqual(result.events.map((event) => event.type), expected.eventTypes);
  assert.deepEqual([result.state.revision], expected.revisionSnapshots);
  assert.deepEqual([result.state.randomConsumptionCount], expected.randomConsumptionCounts);
  assert.deepEqual([hashGameState(result.state)], expected.stateHashes);
  assert.equal(hashGameState(result.state), expected.finalStateHash);
  const serialized = serializeStateForHash(result.state);
  assert.equal(serialized, storedHashInput("g03"));
  assert.equal(standardSha256(serialized), expected.finalStateHash);
});
