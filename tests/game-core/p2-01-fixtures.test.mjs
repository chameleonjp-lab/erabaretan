import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceToNextTurnStart,
  resolveTurnStart,
} from "../../packages/game-core/src/index.ts";
import { createAlpha12Setup, executeAlpha12Command } from "../../packages/content/src/index.ts";

const seed = "123456789abcdef00fedcba987654321";

function setupState(matchId) {
  return createAlpha12Setup({ matchId, seed, playerIds: ["P1", "P2"] }).state;
}

function makeFixtureState({
  matchId,
  hands,
  drawPile = [],
  phase = "ACTION_SELECTION",
  activePlayerId = "P1",
  revision = 0,
  turnSequence = 1,
  hitPoints = { P1: 30, P2: 30 },
  worldDurability = 100,
  triggeredThresholds = [],
  worldDamageResponsibility = { P1: 0, P2: 0 },
  effectiveWorldRestore = { P1: 0, P2: 0 },
}) {
  const base = setupState(matchId);
  const allCardIds = Object.keys(base.cardInstances);
  const requestedHands = { P1: [...hands.P1], P2: [...hands.P2] };
  const requestedDrawPile = [...drawPile];
  const reserved = [...requestedHands.P1, ...requestedHands.P2, ...requestedDrawPile];
  assert.equal(new Set(reserved).size, reserved.length, `${matchId} fixture reuses a card instance`);
  for (const cardInstanceId of reserved) {
    assert.ok(base.cardInstances[cardInstanceId], `${matchId} references an unknown card instance ${cardInstanceId}`);
  }

  const remaining = allCardIds.filter((cardInstanceId) => !reserved.includes(cardInstanceId));
  const completeDrawPile = [...requestedDrawPile, ...remaining];
  const holder = new Map([
    ...requestedHands.P1.map((cardInstanceId) => [cardInstanceId, "P1"]),
    ...requestedHands.P2.map((cardInstanceId) => [cardInstanceId, "P2"]),
  ]);
  const cardInstances = Object.fromEntries(allCardIds.map((cardInstanceId, drawOrder) => {
    const ownerPlayerId = holder.get(cardInstanceId) ?? base.cardInstances[cardInstanceId].ownerPlayerId;
    return [cardInstanceId, {
      ...base.cardInstances[cardInstanceId],
      ownerPlayerId,
      drawOrder,
      zone: holder.has(cardInstanceId) ? "HAND" : "DRAW_PILE",
    }];
  }));

  return {
    ...base,
    phase,
    activePlayerId,
    respondingPlayerId: null,
    revision,
    turnSequence,
    players: {
      ...base.players,
      P1: {
        ...base.players.P1,
        hitPoints: hitPoints.P1,
        hand: requestedHands.P1,
        worldDamageResponsibility: worldDamageResponsibility.P1,
        effectiveWorldRestore: effectiveWorldRestore.P1,
      },
      P2: {
        ...base.players.P2,
        hitPoints: hitPoints.P2,
        hand: requestedHands.P2,
        worldDamageResponsibility: worldDamageResponsibility.P2,
        effectiveWorldRestore: effectiveWorldRestore.P2,
      },
    },
    cardZones: {
      drawPile: completeDrawPile,
      hands: requestedHands,
      discardPile: [],
      revealedCards: [],
      inResolution: [],
    },
    cardInstances,
    world: {
      ...base.world,
      durability: worldDurability,
      triggeredThresholds: [...triggeredThresholds],
      collapseResponsiblePlayerId: null,
    },
    activeField: null,
    pendingAction: null,
    pendingAttack: null,
    effectQueue: [],
    scoreModifiers: [],
    terminalFlags: {
      worldCollapsed: false,
      defeatedPlayerIds: [],
      maxRoundsReached: false,
      endKind: null,
      battleWinnerId: null,
      divineSelectionWinnerId: null,
    },
    judgment: null,
    randomConsumptionCount: 0,
    commandHistory: {},
  };
}

function accepted(result) {
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error(result.error.message);
  return result;
}

function play(commandId, playerId, expectedRevision, cardInstanceId, targetPlayerId) {
  return {
    commandId,
    playerId,
    expectedRevision,
    commandType: "PLAY_CARD",
    payload: {
      cardInstanceId,
      playMode: "RELEASE",
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

test("Fixture A: first turn skips the draw and the next player draws once", () => {
  const base = setupState("fixture-A-first-draw-correction");
  const state = makeFixtureState({
    matchId: "fixture-A-first-draw-correction",
    phase: "TURN_START",
    activePlayerId: "P1",
    revision: 100,
    hands: {
      P1: base.cardZones.hands.P1,
      P2: base.cardZones.hands.P2,
    },
    drawPile: ["attack.steadfast-strike.v1#03", "attack.steadfast-strike.v1#02"],
  });

  const firstTurn = resolveTurnStart(state);
  assert.equal(firstTurn.phase, "ACTION_SELECTION");
  assert.equal(firstTurn.revision, 101);
  assert.equal(firstTurn.players.P1.hand.length, 7);
  assert.deepEqual(firstTurn.cardZones.drawPile.slice(0, 2), [
    "attack.steadfast-strike.v1#03",
    "attack.steadfast-strike.v1#02",
  ]);

  const discarded = accepted(executeAlpha12Command(firstTurn, {
    commandId: "fixture-a-discard-001",
    playerId: "P1",
    expectedRevision: 101,
    commandType: "DISCARD_FOR_ACTION",
    payload: { cardInstanceId: firstTurn.players.P1.hand[0] },
  }));
  assert.equal(discarded.state.phase, "TURN_END");
  assert.equal(discarded.state.revision, 102);

  const nextTurnStart = advanceToNextTurnStart(discarded.state);
  const secondTurn = resolveTurnStart(nextTurnStart);
  assert.equal(secondTurn.phase, "ACTION_SELECTION");
  assert.equal(secondTurn.activePlayerId, "P2");
  assert.equal(secondTurn.revision, 103);
  assert.equal(secondTurn.players.P1.hand.length, 6);
  assert.equal(secondTurn.players.P2.hand.length, 8);
  assert.equal(secondTurn.cardZones.drawPile[0], "attack.steadfast-strike.v1#02");
  assert.equal(secondTurn.cardInstances["attack.steadfast-strike.v1#03"].ownerPlayerId, "P2");
  assert.equal(secondTurn.cardInstances["attack.steadfast-strike.v1#03"].zone, "HAND");
  assert.ok(secondTurn.players.P2.hand.includes("attack.steadfast-strike.v1#03"));
});

test("Fixture A: hand ceiling and overflow do not draw repeatedly", () => {
  const base = setupState("fixture-A-hand-ceiling");
  const allCardIds = Object.keys(base.cardInstances);
  const ceiling = makeFixtureState({
    matchId: "fixture-A-hand-ceiling",
    phase: "TURN_START",
    activePlayerId: "P1",
    revision: 110,
    turnSequence: 2,
    hands: { P1: allCardIds.slice(0, 9), P2: allCardIds.slice(10, 17) },
    drawPile: [allCardIds[9]],
  });
  const ceilingResolved = resolveTurnStart(ceiling);
  assert.equal(ceilingResolved.phase, "ACTION_SELECTION");
  assert.equal(ceilingResolved.revision, 111);
  assert.equal(ceilingResolved.players.P1.hand.length, 9);
  assert.equal(ceilingResolved.cardZones.drawPile[0], allCardIds[9]);
  assert.equal(ceilingResolved.cardInstances[allCardIds[9]].zone, "DRAW_PILE");

  const overflow = makeFixtureState({
    matchId: "fixture-A-existing-overflow",
    phase: "TURN_START",
    activePlayerId: "P1",
    revision: 120,
    turnSequence: 2,
    hands: { P1: allCardIds.slice(0, 10), P2: allCardIds.slice(10, 17) },
    drawPile: [allCardIds[17]],
  });
  const overflowResolved = resolveTurnStart(overflow);
  assert.strictEqual(overflowResolved, overflow);
  assert.equal(overflowResolved.revision, 120);
  assert.equal(overflowResolved.phase, "TURN_START");
  assert.equal(overflowResolved.players.P1.hand.length, 10);
  assert.equal(overflowResolved.cardZones.drawPile[0], allCardIds[17]);
  assert.strictEqual(resolveTurnStart(overflowResolved), overflowResolved);
});

test("Fixture B: star breaker crosses 75 and attributes the penalty to the world-damaging player", () => {
  const played = accepted(executeAlpha12Command(makeFixtureState({
    matchId: "fixture-B-world-75",
    revision: 200,
    hands: {
      P1: ["attack.star-breaker.v1#01"],
      P2: ["attack.steadfast-strike.v1#02"],
    },
    drawPile: [],
    worldDurability: 79,
  }), play("fixture-b-play-001", "P1", 200, "attack.star-breaker.v1#01", "P2")));
  assert.deepEqual(played.events.map((event) => event.type), ["COMMAND_ACCEPTED", "CARD_PLAYED"]);
  assert.equal(played.state.phase, "RESPONSE_SELECTION");

  const resolved = accepted(executeAlpha12Command(played.state, acceptDamage("fixture-b-accept-001", "P2", 201)));
  assert.equal(resolved.state.phase, "TURN_START");
  assert.equal(resolved.state.activePlayerId, "P2");
  assert.equal(resolved.state.players.P1.hitPoints, 30);
  assert.equal(resolved.state.players.P2.hitPoints, 14);
  assert.equal(resolved.state.world.durability, 72);
  assert.deepEqual(resolved.state.world.triggeredThresholds, [75]);
  assert.equal(resolved.state.players.P1.worldDamageResponsibility, 7);
  assert.equal(resolved.state.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.deepEqual(resolved.state.cardZones.discardPile, ["attack.star-breaker.v1#01"]);
  assert.deepEqual(resolved.events.map((event) => event.type), [
    "COMMAND_ACCEPTED",
    "RESPONSE_ACCEPTED",
    "DAMAGE_PLAYER_APPLIED",
    "DAMAGE_WORLD_APPLIED",
    "WORLD_THRESHOLD_TRIGGERED",
    "WORLD_LAW_EFFECT_APPLIED",
  ]);
});

test("Fixture C: oath of renewal pays HP separately from world restoration", () => {
  const result = accepted(executeAlpha12Command(makeFixtureState({
    matchId: "fixture-C-oath-of-renewal",
    revision: 300,
    hands: {
      P1: ["intervention.oath-of-renewal.v1#01"],
      P2: ["attack.steadfast-strike.v1#02"],
    },
    drawPile: [],
    hitPoints: { P1: 8, P2: 30 },
    worldDurability: 45,
  }), play("fixture-c-play-001", "P1", 300, "intervention.oath-of-renewal.v1#01")));

  assert.deepEqual(result.events.map((event) => event.type), [
    "COMMAND_ACCEPTED",
    "CARD_PLAYED",
    "PAY_HP_APPLIED",
    "RESTORE_WORLD_APPLIED",
  ]);
  assert.equal(result.state.revision, 301);
  assert.equal(result.state.phase, "TURN_START");
  assert.equal(result.state.activePlayerId, "P2");
  assert.equal(result.state.players.P1.hitPoints, 4);
  assert.equal(result.state.world.durability, 52);
  assert.equal(result.state.players.P1.effectiveWorldRestore, 7);
  assert.equal(result.state.players.P1.worldDamageResponsibility, 0);
});

test("Fixture D: green bargain reduces damage, restores the world, and receives the 50-boundary draw", () => {
  const played = accepted(executeAlpha12Command(makeFixtureState({
    matchId: "fixture-D-world-50-green-response",
    revision: 400,
    hands: {
      P1: ["attack.rift-pebble.v1#01"],
      P2: ["intervention.verdant-bargain.v1#01", "attack.steadfast-strike.v1#02"],
    },
    drawPile: ["attack.steadfast-strike.v1#03"],
    worldDurability: 52,
  }), play("fixture-d-play-001", "P1", 400, "attack.rift-pebble.v1#01", "P2")));
  assert.equal(played.state.phase, "RESPONSE_SELECTION");

  const resolved = accepted(executeAlpha12Command(played.state, {
    commandId: "fixture-d-response-001",
    playerId: "P2",
    expectedRevision: 401,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "intervention.verdant-bargain.v1#01", responseMode: "RESPONSE" },
  }));
  assert.equal(resolved.state.phase, "TURN_START");
  assert.equal(resolved.state.activePlayerId, "P2");
  assert.equal(resolved.state.players.P1.hitPoints, 30);
  assert.equal(resolved.state.players.P2.hitPoints, 29);
  assert.equal(resolved.state.world.durability, 54);
  assert.deepEqual(resolved.state.world.triggeredThresholds, [50]);
  assert.equal(resolved.state.players.P1.worldDamageResponsibility, 2);
  assert.equal(resolved.state.players.P2.effectiveWorldRestore, 4);
  assert.deepEqual(resolved.state.players.P2.hand, [
    "attack.steadfast-strike.v1#02",
    "attack.steadfast-strike.v1#03",
  ]);
  assert.deepEqual(resolved.state.cardZones.discardPile, [
    "attack.rift-pebble.v1#01",
    "intervention.verdant-bargain.v1#01",
  ]);
  assert.deepEqual(resolved.events.map((event) => event.type), [
    "COMMAND_ACCEPTED",
    "RESPONSE_ACCEPTED",
    "INCOMING_DAMAGE_REDUCED",
    "DAMAGE_PLAYER_APPLIED",
    "DAMAGE_WORLD_APPLIED",
    "WORLD_THRESHOLD_TRIGGERED",
    "RESTORE_WORLD_APPLIED",
    "WORLD_LAW_EFFECT_APPLIED",
    "DRAW_CARD",
  ]);
});

test("Fixture E: the crossing card avoids fragile self-damage, while the next one pays it", () => {
  const firstPlayed = accepted(executeAlpha12Command(makeFixtureState({
    matchId: "fixture-E-world-25-self-damage",
    revision: 500,
    hands: {
      P1: ["attack.rift-pebble.v1#01"],
      P2: ["attack.rift-pebble.v1#02"],
    },
    drawPile: [],
    worldDurability: 27,
  }), play("fixture-e-play-001", "P1", 500, "attack.rift-pebble.v1#01", "P2")));
  const firstResolved = accepted(executeAlpha12Command(firstPlayed.state, acceptDamage("fixture-e-accept-001", "P2", 501)));
  assert.equal(firstResolved.state.players.P1.hitPoints, 30);
  assert.equal(firstResolved.state.players.P2.hitPoints, 26);
  assert.equal(firstResolved.state.world.durability, 25);
  assert.deepEqual(firstResolved.state.world.triggeredThresholds, [25]);

  const secondTurn = resolveTurnStart(firstResolved.state);
  const secondPlayed = accepted(executeAlpha12Command(secondTurn, play("fixture-e-play-002", "P2", 503, "attack.rift-pebble.v1#02", "P1")));
  const final = accepted(executeAlpha12Command(secondPlayed.state, acceptDamage("fixture-e-accept-002", "P1", 504)));
  assert.equal(final.state.phase, "TURN_START");
  assert.equal(final.state.activePlayerId, "P1");
  assert.equal(final.state.players.P1.hitPoints, 26);
  assert.equal(final.state.players.P2.hitPoints, 24);
  assert.equal(final.state.world.durability, 23);
  assert.deepEqual(final.state.world.triggeredThresholds, [25]);
  assert.equal(final.state.players.P1.worldDamageResponsibility, 2);
  assert.equal(final.state.players.P2.worldDamageResponsibility, 2);
  assert.equal(final.state.players.P1.statusEffects.fragileWorld, true);
  assert.equal(final.state.players.P2.statusEffects.fragileWorld, true);
});

test("Fixture F: normal defeat preserves the 72-to-2 judgment and battle/divine winners", () => {
  const played = accepted(executeAlpha12Command(makeFixtureState({
    matchId: "fixture-F-normal-defeat-judgment",
    revision: 600,
    hands: {
      P1: ["attack.steadfast-strike.v1#01"],
      P2: ["attack.steadfast-strike.v1#02"],
    },
    drawPile: [],
    hitPoints: { P1: 30, P2: 6 },
    worldDurability: 100,
  }), play("fixture-f-play-001", "P1", 600, "attack.steadfast-strike.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, acceptDamage("fixture-f-accept-001", "P2", 601)));

  assert.equal(final.state.phase, "FINISHED");
  assert.equal(final.state.terminalFlags.endKind, "NORMAL");
  assert.deepEqual(final.state.terminalFlags.defeatedPlayerIds, ["P2"]);
  assert.equal(final.state.terminalFlags.worldCollapsed, false);
  assert.equal(final.state.terminalFlags.maxRoundsReached, false);
  assert.equal(final.state.terminalFlags.battleWinnerId, "P1");
  assert.equal(final.state.terminalFlags.divineSelectionWinnerId, "P1");
  assert.deepEqual(final.state.judgment?.playerScores, { P1: 72, P2: 2 });
  assert.deepEqual(final.events.map((event) => event.type), [
    "COMMAND_ACCEPTED",
    "RESPONSE_ACCEPTED",
    "DAMAGE_PLAYER_APPLIED",
    "PLAYER_DEFEATED",
    "JUDGMENT_COMPUTED",
    "MATCH_FINISHED",
  ]);
});
