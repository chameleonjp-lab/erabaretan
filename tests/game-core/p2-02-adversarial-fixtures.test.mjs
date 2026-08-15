import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectQueue,
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
  discardPile = [],
  remainingZone = "DRAW_PILE",
  phase = "ACTION_SELECTION",
  activePlayerId = "P1",
  revision = 0,
  turnSequence = 1,
  roundNumber = 1,
  hitPoints = { P1: 30, P2: 30 },
  worldDurability = 100,
  triggeredThresholds = [],
  worldDamageResponsibility = { P1: 0, P2: 0 },
  effectiveWorldRestore = { P1: 0, P2: 0 },
  statusEffects = {},
  activeField = null,
}) {
  const base = setupState(matchId);
  const allCardIds = Object.keys(base.cardInstances);
  const requestedHands = { P1: [...(hands.P1 ?? [])], P2: [...(hands.P2 ?? [])] };
  const requestedDrawPile = [...drawPile];
  const requestedDiscardPile = [...discardPile];
  const reserved = [...requestedHands.P1, ...requestedHands.P2, ...requestedDrawPile, ...requestedDiscardPile];
  assert.equal(new Set(reserved).size, reserved.length, `${matchId} fixture reuses a card instance`);
  for (const cardInstanceId of reserved) {
    assert.ok(base.cardInstances[cardInstanceId], `${matchId} references an unknown card instance ${cardInstanceId}`);
  }

  const remaining = allCardIds.filter((cardInstanceId) => !reserved.includes(cardInstanceId));
  const completeDrawPile = remainingZone === "DRAW_PILE" ? [...requestedDrawPile, ...remaining] : [...requestedDrawPile];
  const completeDiscardPile = remainingZone === "DISCARD_PILE" ? [...requestedDiscardPile, ...remaining] : [...requestedDiscardPile];
  const handOwners = new Map([
    ...requestedHands.P1.map((cardInstanceId) => [cardInstanceId, "P1"]),
    ...requestedHands.P2.map((cardInstanceId) => [cardInstanceId, "P2"]),
  ]);
  const drawIds = new Set(completeDrawPile);
  const discardIds = new Set(completeDiscardPile);
  const cardInstances = Object.fromEntries(allCardIds.map((cardInstanceId, drawOrder) => {
    const ownerPlayerId = handOwners.get(cardInstanceId) ?? base.cardInstances[cardInstanceId].ownerPlayerId;
    const zone = handOwners.has(cardInstanceId)
      ? "HAND"
      : drawIds.has(cardInstanceId) ? "DRAW_PILE" : "DISCARD_PILE";
    return [cardInstanceId, { ...base.cardInstances[cardInstanceId], ownerPlayerId, drawOrder, zone }];
  }));

  return {
    ...base,
    phase,
    roundNumber,
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
        statusEffects: { ...base.players.P1.statusEffects, ...(statusEffects.P1 ?? {}) },
      },
      P2: {
        ...base.players.P2,
        hitPoints: hitPoints.P2,
        hand: requestedHands.P2,
        worldDamageResponsibility: worldDamageResponsibility.P2,
        effectiveWorldRestore: effectiveWorldRestore.P2,
        statusEffects: { ...base.players.P2.statusEffects, ...(statusEffects.P2 ?? {}) },
      },
    },
    cardZones: {
      drawPile: completeDrawPile,
      hands: requestedHands,
      discardPile: completeDiscardPile,
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
    activeField,
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

function cardSource({
  ownerPlayerId = "P1",
  cardDefinitionId = "attack.rift-pebble.v1",
  cardInstanceId = "attack.rift-pebble.v1#01",
  mode = "RELEASE",
} = {}) {
  return {
    sourceKind: "CARD",
    ownerPlayerId,
    cardDefinitionId,
    cardInstanceId,
    mode,
  };
}

function worldEffect(effectId, commandType, amount, source, reason) {
  return {
    effectId,
    commandType,
    source,
    target: { targetKind: "WORLD" },
    payload: { amount, reason },
    attributionPolicy: "SOURCE_OWNER",
    executionTiming: "IMMEDIATE",
  };
}

function assertNoMutation(result, state, code, beforeSnapshot) {
  assert.equal(result.accepted, false);
  assert.strictEqual(result.state, state);
  assert.deepEqual(result.state, beforeSnapshot);
  assert.equal(result.error.code, code);
  assert.deepEqual(result.events.map((event) => event.type), ["COMMAND_REJECTED"]);
  assert.equal(result.events[0].reasonCode, code);
  assert.equal(result.events[0].revision, state.revision);
}

function rejectWithoutMutation(state, command, code) {
  const beforeSnapshot = structuredClone(state);
  const result = executeAlpha12Command(state, command);
  assertNoMutation(result, state, code, beforeSnapshot);
}

test("P2-02 X01: exact 75 crossing triggers once and does not retrigger at 75", () => {
  const state = makeFixtureState({
    matchId: "fixture-X01-exact-threshold",
    hands: { P1: ["attack.rift-pebble.v1#01", "attack.rift-pebble.v1#02"], P2: ["attack.steadfast-strike.v1#01"] },
    worldDurability: 77,
  });
  const aboveBoundary = resolveEffectQueue(state, [
    worldEffect(
      "effect.x01.above-boundary.0001",
      "DAMAGE_WORLD",
      1,
      cardSource({ ownerPlayerId: "P1", cardInstanceId: "attack.rift-pebble.v1#02" }),
      "CARD_RELEASE",
    ),
  ]);
  assert.equal(aboveBoundary.committed, true);
  assert.equal(aboveBoundary.state.world.durability, 76);
  assert.deepEqual(aboveBoundary.state.world.triggeredThresholds, []);
  assert.equal(aboveBoundary.events.some((event) => event.type === "WORLD_THRESHOLD_TRIGGERED"), false);
  const played = accepted(executeAlpha12Command(state, play("x01-play", "P1", 0, "attack.rift-pebble.v1#01", "P2")));
  const crossed = accepted(executeAlpha12Command(played.state, acceptDamage("x01-accept", "P2", 1)));
  assert.equal(crossed.state.world.durability, 75);
  assert.deepEqual(crossed.state.world.triggeredThresholds, [75]);
  assert.equal(crossed.events.filter((event) => event.type === "WORLD_THRESHOLD_TRIGGERED").length, 1);

  const recrossed = resolveEffectQueue(crossed.state, [
    worldEffect(
      "effect.x01.restore.0001",
      "RESTORE_WORLD",
      2,
      cardSource({ ownerPlayerId: "P2", cardDefinitionId: "attack.steadfast-strike.v1", cardInstanceId: "attack.steadfast-strike.v1#01" }),
      "CARD_RESPONSE",
    ),
    worldEffect(
      "effect.x01.damage.0001",
      "DAMAGE_WORLD",
      1,
      cardSource({ ownerPlayerId: "P1", cardInstanceId: "attack.rift-pebble.v1#01" }),
      "CARD_RELEASE",
    ),
    worldEffect(
      "effect.x01.damage.0002",
      "DAMAGE_WORLD",
      1,
      cardSource({ ownerPlayerId: "P1", cardInstanceId: "attack.rift-pebble.v1#01" }),
      "CARD_RELEASE",
    ),
  ]);
  assert.equal(recrossed.committed, true);
  assert.equal(recrossed.state.world.durability, 75);
  assert.deepEqual(recrossed.state.world.triggeredThresholds, [75]);
  assert.equal(recrossed.events.filter((event) => event.type === "WORLD_THRESHOLD_TRIGGERED").length, 0);
});

test("P2-02 X02: recovery and re-crossing never append a duplicate threshold", () => {
  const state = makeFixtureState({
    matchId: "fixture-X02-recrossing",
    hands: {
      P1: ["attack.rift-pebble.v1#01", "attack.rift-pebble.v1#03"],
      P2: ["intervention.verdant-bargain.v1#01", "attack.rift-pebble.v1#02"],
    },
    worldDurability: 77,
  });
  const result = resolveEffectQueue(state, [
    worldEffect("effect.x02.damage.0001", "DAMAGE_WORLD", 2, cardSource({ ownerPlayerId: "P1", cardInstanceId: "attack.rift-pebble.v1#01" }), "CARD_RELEASE"),
    worldEffect("effect.x02.restore.0001", "RESTORE_WORLD", 4, cardSource({ ownerPlayerId: "P2", cardDefinitionId: "intervention.verdant-bargain.v1", cardInstanceId: "intervention.verdant-bargain.v1#01", mode: "RESPONSE" }), "CARD_RESPONSE"),
    worldEffect("effect.x02.damage.0002", "DAMAGE_WORLD", 2, cardSource({ ownerPlayerId: "P2", cardInstanceId: "attack.rift-pebble.v1#02" }), "CARD_RELEASE"),
    worldEffect("effect.x02.damage.0003", "DAMAGE_WORLD", 2, cardSource({ ownerPlayerId: "P1", cardInstanceId: "attack.rift-pebble.v1#03" }), "CARD_RELEASE"),
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.state.world.durability, 75);
  assert.deepEqual(result.state.world.triggeredThresholds, [75]);
  assert.equal(result.state.players.P2.effectiveWorldRestore, 4);
  assert.equal(result.events.filter((event) => event.type === "WORLD_THRESHOLD_TRIGGERED").length, 1);
});

test("P2-02 X03: one effect queue crosses 75, 50, and 25 in descending order", () => {
  const state = makeFixtureState({
    matchId: "fixture-X03-multiple-boundaries",
    hands: { P1: ["attack.star-breaker.v1#01"], P2: ["attack.steadfast-strike.v1#01"] },
    worldDurability: 80,
  });
  const result = resolveEffectQueue(state, [
    worldEffect(
      "effect.x03.damage.0001",
      "DAMAGE_WORLD",
      60,
      cardSource({ ownerPlayerId: "P1", cardDefinitionId: "attack.star-breaker.v1", cardInstanceId: "attack.star-breaker.v1#01" }),
      "CARD_RELEASE",
    ),
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.state.world.durability, 20);
  assert.deepEqual(result.state.world.triggeredThresholds, [75, 50, 25]);
  assert.equal(result.state.players.P1.worldDamageResponsibility, 60);
  assert.equal(result.state.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.equal(result.state.players.P1.statusEffects.fragileWorld, true);
  assert.deepEqual(result.events.filter((event) => event.type === "WORLD_LAW_EFFECT_APPLIED").map((event) => event.details.threshold), [75, 50, 25]);
  const significantEvents = result.events
    .filter((event) => event.type === "DAMAGE_WORLD_APPLIED" || event.type === "WORLD_LAW_EFFECT_APPLIED")
    .map((event) => event.type === "DAMAGE_WORLD_APPLIED" ? event.type : `${event.type}:${event.details.threshold}`);
  assert.deepEqual(significantEvents, [
    "DAMAGE_WORLD_APPLIED",
    "WORLD_LAW_EFFECT_APPLIED:75",
    "WORLD_LAW_EFFECT_APPLIED:50",
    "WORLD_LAW_EFFECT_APPLIED:25",
  ]);
  assert.equal(result.events.some((event) => event.type === "DAMAGE_PLAYER_APPLIED"), false);
});

test("P2-02 X04: world damage clamps at zero and records collapse without negative durability", () => {
  const state = makeFixtureState({
    matchId: "fixture-X04-world-collapse-clamp",
    hands: { P1: ["attack.star-breaker.v1#01"], P2: ["attack.steadfast-strike.v1#01"] },
    worldDurability: 6,
  });
  const played = accepted(executeAlpha12Command(state, play("x04-play", "P1", 0, "attack.star-breaker.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, acceptDamage("x04-accept", "P2", 1)));
  assert.equal(final.state.world.durability, 0);
  assert.equal(final.state.terminalFlags.worldCollapsed, true);
  assert.equal(final.state.players.P1.worldDamageResponsibility, 6);
  assert.equal(final.state.players.P2.hitPoints, 14);
  assert.equal(final.state.scoreModifiers.find((modifier) => modifier.modifierKind === "WORLD_COLLAPSE_PENALTY")?.amount, 25);
  assert.equal(final.state.world.durability < 0, false);
  assert.deepEqual(final.state.terminalFlags.defeatedPlayerIds, []);
});

test("P2-02 X05: full-world restoration is a no-op and creates no restoration responsibility", () => {
  const state = makeFixtureState({
    matchId: "fixture-X05-full-world-restore",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["intervention.verdant-bargain.v1#01"] },
    worldDurability: 100,
  });
  const played = accepted(executeAlpha12Command(state, play("x05-play", "P1", 0, "attack.steadfast-strike.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, {
    commandId: "x05-response",
    playerId: "P2",
    expectedRevision: 1,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "intervention.verdant-bargain.v1#01", responseMode: "RESPONSE" },
  }));
  assert.equal(final.state.players.P2.hitPoints, 27);
  assert.equal(final.state.world.durability, 100);
  assert.equal(final.state.players.P2.effectiveWorldRestore, 0);
  assert.deepEqual(final.state.world.triggeredThresholds, []);
  assert.equal(final.events.some((event) => event.type === "RESTORE_WORLD_APPLIED"), false);
  assert.equal(final.events.some((event) => event.type === "WORLD_THRESHOLD_TRIGGERED"), false);
  assert.ok(final.state.cardZones.discardPile.includes("intervention.verdant-bargain.v1#01"));
});

test("P2-02 X06: equal responsibility gives the 75 penalty to every tied player", () => {
  const state = makeFixtureState({
    matchId: "fixture-X06-tied-responsibility",
    hands: { P1: ["attack.star-breaker.v1#01"], P2: ["defense.ashen-bulwark.v1#01"] },
    worldDurability: 80,
    worldDamageResponsibility: { P1: 0, P2: 3 },
  });
  const played = accepted(executeAlpha12Command(state, play("x06-play", "P1", 0, "attack.star-breaker.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, {
    commandId: "x06-response",
    playerId: "P2",
    expectedRevision: 1,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "defense.ashen-bulwark.v1#01", responseMode: "RESPONSE" },
  }));
  assert.equal(final.state.world.durability, 69);
  assert.deepEqual(final.state.world.triggeredThresholds, [75]);
  assert.equal(final.state.players.P1.worldDamageResponsibility, 7);
  assert.equal(final.state.players.P2.worldDamageResponsibility, 7);
  assert.equal(final.state.players.P1.statusEffects.nextDefensePenalty, 1);
  assert.equal(final.state.players.P2.statusEffects.nextDefensePenalty, 1);
});

test("P2-02 X07: an unused 75 penalty remains, then is consumed by the next defense card", () => {
  const state = makeFixtureState({
    matchId: "fixture-X07-penalty-consumption",
    hands: {
      P1: ["attack.star-breaker.v1#01", "defense.guardian-veil.v1#01"],
      P2: ["attack.steadfast-strike.v1#01"],
    },
    worldDurability: 79,
  });
  const firstPlayed = accepted(executeAlpha12Command(state, play("x07-first-play", "P1", 0, "attack.star-breaker.v1#01", "P2")));
  const firstResolved = accepted(executeAlpha12Command(firstPlayed.state, acceptDamage("x07-first-accept", "P2", 1)));
  assert.equal(firstResolved.state.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.equal(firstResolved.events.find((event) => event.type === "WORLD_LAW_EFFECT_APPLIED")?.details.penalty, 2);

  const p2Action = resolveTurnStart(firstResolved.state);
  const secondPlayed = accepted(executeAlpha12Command(p2Action, play("x07-second-play", "P2", p2Action.revision, "attack.steadfast-strike.v1#01", "P1")));
  const final = accepted(executeAlpha12Command(secondPlayed.state, {
    commandId: "x07-second-response",
    playerId: "P1",
    expectedRevision: secondPlayed.state.revision,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "defense.guardian-veil.v1#01", responseMode: "RESPONSE" },
  }));
  assert.equal(final.events.find((event) => event.type === "SHIELD_ADDED")?.details.amount, 7);
  const appliedDamage = final.events.find((event) => event.type === "DAMAGE_PLAYER_APPLIED");
  assert.equal(appliedDamage?.details.amount, 1);
  const baseDamage = secondPlayed.state.pendingAttack?.baseDamage;
  assert.equal(baseDamage, 6);
  assert.equal(baseDamage - (appliedDamage?.details.amount ?? 0), 5);
  assert.equal(final.state.players.P1.hitPoints, 29);
  assert.equal(final.state.players.P1.statusEffects.nextDefensePenalty, 0);
  assert.deepEqual(final.state.players.P1.statusEffects.shields, []);
});

test("P2-02 X08: empty draw pile consumes the 50 boundary once without fabricating a card", () => {
  const state = makeFixtureState({
    matchId: "fixture-X08-empty-draw-pile",
    hands: { P1: ["attack.rift-pebble.v1#01"], P2: ["intervention.verdant-bargain.v1#01"] },
    remainingZone: "DISCARD_PILE",
    worldDurability: 52,
  });
  const played = accepted(executeAlpha12Command(state, play("x08-play", "P1", 0, "attack.rift-pebble.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, {
    commandId: "x08-response",
    playerId: "P2",
    expectedRevision: 1,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "intervention.verdant-bargain.v1#01", responseMode: "RESPONSE" },
  }));
  assert.equal(final.state.cardZones.drawPile.length, 0);
  assert.equal(final.state.players.P2.hand.length, 0);
  assert.equal(final.state.world.durability, 54);
  assert.deepEqual(final.state.world.triggeredThresholds, [50]);
  assert.equal(final.state.players.P2.effectiveWorldRestore, 4);
  assert.equal(final.events.some((event) => event.type === "DRAW_CARD"), false);
  assert.deepEqual(final.events.filter((event) => event.type === "WORLD_LAW_EFFECT_APPLIED").map((event) => event.details), [
    { threshold: 50, targetPlayerId: "P2", draw: 0 },
  ]);
});

test("P2-02 X09: zero effective world damage does not trigger fragile-world self damage", () => {
  const state = makeFixtureState({
    matchId: "fixture-X09-zero-effective-damage",
    hands: { P1: ["attack.rift-pebble.v1#01"], P2: ["attack.steadfast-strike.v1#01"] },
    turnSequence: 2,
    worldDurability: 25,
    triggeredThresholds: [25],
    activeField: {
      fieldDefinitionId: "field.root-sanctuary.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 5,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: null,
    },
  });
  const played = accepted(executeAlpha12Command(state, play("x09-play", "P1", 0, "attack.rift-pebble.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, acceptDamage("x09-accept", "P2", 1)));
  assert.equal(final.state.world.durability, 25);
  assert.equal(final.state.players.P1.worldDamageResponsibility, 0);
  assert.equal(final.state.players.P1.hitPoints, 30);
  assert.equal(final.state.players.P2.hitPoints, 26);
  assert.equal(final.events.filter((event) => event.type === "DAMAGE_PLAYER_APPLIED").length, 1);
  const worldDamageEvent = final.events.find((event) => event.type === "DAMAGE_WORLD_APPLIED");
  assert.equal(worldDamageEvent?.details.requested, 0);
  assert.equal(worldDamageEvent?.details.effective, 0);
});

test("P2-02 X10: fragile-world self damage uses and consumes an ordinary shield", () => {
  const state = makeFixtureState({
    matchId: "fixture-X10-fragile-shield",
    hands: { P1: ["attack.rift-pebble.v1#01"], P2: ["attack.steadfast-strike.v1#01"] },
    worldDurability: 25,
    triggeredThresholds: [25],
    statusEffects: {
      P1: {
        fragileWorld: true,
        shields: [{ amount: 1, scope: "NEXT_APPLICABLE_ATTACK", pendingAttackId: null, expiresAfterTurnSequence: 3 }],
      },
      P2: { fragileWorld: true },
    },
  });
  const played = accepted(executeAlpha12Command(state, play("x10-play", "P1", 0, "attack.rift-pebble.v1#01", "P2")));
  const final = accepted(executeAlpha12Command(played.state, acceptDamage("x10-accept", "P2", 1)));
  assert.equal(final.state.world.durability, 23);
  assert.equal(final.state.players.P1.worldDamageResponsibility, 2);
  assert.equal(final.state.players.P1.hitPoints, 29);
  assert.deepEqual(final.state.players.P1.statusEffects.shields, []);
  assert.deepEqual(final.events.filter((event) => event.type === "DAMAGE_PLAYER_APPLIED").map((event) => event.details.amount), [4, 1]);
});

test("P2-02 X11: replacing a field clears the old field without running its expiry effect", () => {
  const state = makeFixtureState({
    matchId: "fixture-X11-field-overwrite",
    activePlayerId: "P2",
    turnSequence: 2,
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["field.root-sanctuary.v1#01"] },
    activeField: {
      fieldDefinitionId: "field.frenzied-fracture.v1",
      ownerPlayerId: "P1",
      expiresAfterTurnSequence: 5,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: null,
    },
  });
  const result = accepted(executeAlpha12Command(state, play("x11-play", "P2", 0, "field.root-sanctuary.v1#01")));
  const fieldEvents = result.events.filter((event) => ["FIELD_CLEARED", "FIELD_SET"].includes(event.type));
  assert.deepEqual(fieldEvents.map((event) => event.type), ["FIELD_CLEARED", "FIELD_SET"]);
  assert.deepEqual(fieldEvents.map((event) => event.details.fieldDefinitionId), [
    "field.frenzied-fracture.v1",
    "field.root-sanctuary.v1",
  ]);
  assert.equal(result.state.activeField?.fieldDefinitionId, "field.root-sanctuary.v1");
  assert.equal(result.state.activeField?.ownerPlayerId, "P2");
  assert.equal(result.state.activeField?.expiresAfterTurnSequence, 5);
  assert.equal(result.state.world.durability, 100);
  assert.equal(result.events.some((event) => event.type === "FIELD_EXPIRED"), false);
});

test("P2-02 X12: field nullification clears mitigation before damaging the world", () => {
  const state = makeFixtureState({
    matchId: "fixture-X12-nullification-order",
    hands: { P1: ["intervention.field-nullification.v1#01"], P2: ["attack.steadfast-strike.v1#01"] },
    worldDurability: 80,
    activeField: {
      fieldDefinitionId: "field.root-sanctuary.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 5,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: null,
    },
  });
  const result = accepted(executeAlpha12Command(state, play("x12-play", "P1", 0, "intervention.field-nullification.v1#01")));
  const relevantEvents = result.events.filter((event) => ["FIELD_CLEARED", "DAMAGE_WORLD_APPLIED"].includes(event.type));
  assert.deepEqual(relevantEvents.map((event) => event.type), ["FIELD_CLEARED", "DAMAGE_WORLD_APPLIED"]);
  assert.equal(result.state.activeField, null);
  assert.equal(result.state.world.durability, 78);
  assert.equal(result.state.players.P1.worldDamageResponsibility, 2);
});

test("P2-02 X13: response replay is idempotent and a new stale command is rejected", () => {
  const state = makeFixtureState({
    matchId: "fixture-X13-replay-stale",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  const played = accepted(executeAlpha12Command(state, play("x13-play", "P1", 0, "attack.steadfast-strike.v1#01", "P2")));
  const responseCommand = acceptDamage("x13-response", "P2", played.state.revision);
  const first = accepted(executeAlpha12Command(played.state, responseCommand));
  assert.equal(first.state.players.P2.hitPoints, 24);
  const beforeReplaySnapshot = structuredClone(first.state);
  const discardBeforeReplay = [...first.state.cardZones.discardPile];
  const historyBeforeReplay = structuredClone(first.state.commandHistory);
  const replay = executeAlpha12Command(first.state, responseCommand);
  assert.equal(replay.accepted, true);
  if (replay.accepted) {
    assert.equal(replay.replayed, true);
    assert.strictEqual(replay.state, first.state);
    assert.deepEqual(replay.state, beforeReplaySnapshot);
    assert.deepEqual(replay.state.cardZones.discardPile, discardBeforeReplay);
    assert.deepEqual(replay.state.commandHistory, historyBeforeReplay);
    assert.deepEqual(replay.events, first.events.slice(0, 2));
    assert.equal(replay.state.players.P2.hitPoints, 24);
  }
  rejectWithoutMutation(first.state, acceptDamage("x13-stale-new", "P2", played.state.revision), "STALE_REVISION");
});

test("P2-02 X14: invalid sender, phase, card ownership, and card condition do not mutate state", () => {
  const wrongSenderState = makeFixtureState({
    matchId: "fixture-X14-a-wrong-sender",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  rejectWithoutMutation(
    wrongSenderState,
    play("x14-a", "P2", 0, "attack.steadfast-strike.v1#02", "P1"),
    "NOT_ACTIVE_PLAYER",
  );

  const wrongPhaseState = makeFixtureState({
    matchId: "fixture-X14-b-wrong-phase",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  rejectWithoutMutation(wrongPhaseState, {
      commandId: "x14-b",
      playerId: "P1",
      expectedRevision: 0,
      commandType: "SELECT_RESPONSE",
      payload: { cardInstanceId: "attack.steadfast-strike.v1#02", responseMode: "RESPONSE" },
    },
    "COMMAND_NOT_ALLOWED_IN_PHASE",
  );

  const missingCardState = makeFixtureState({
    matchId: "fixture-X14-c-missing-card",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  rejectWithoutMutation(
    missingCardState,
    play("x14-c", "P1", 0, "attack.rift-pebble.v1#03", "P2"),
    "CARD_NOT_IN_HAND",
  );

  const lowHpState = makeFixtureState({
    matchId: "fixture-X14-d-condition",
    hands: { P1: ["intervention.oath-of-renewal.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
    hitPoints: { P1: 4, P2: 30 },
    worldDurability: 45,
  });
  rejectWithoutMutation(lowHpState, play("x14-d", "P1", 0, "intervention.oath-of-renewal.v1#01"), "CARD_CONDITION_NOT_MET");

  const fullWorldState = makeFixtureState({
    matchId: "fixture-X14-e-full-world",
    hands: { P1: ["intervention.oath-of-renewal.v1#02"], P2: ["attack.steadfast-strike.v1#02"] },
    hitPoints: { P1: 8, P2: 30 },
    worldDurability: 100,
  });
  rejectWithoutMutation(fullWorldState, play("x14-e", "P1", 0, "intervention.oath-of-renewal.v1#02"), "CARD_CONDITION_NOT_MET");

  const noFieldState = makeFixtureState({
    matchId: "fixture-X14-f-no-field",
    hands: { P1: ["intervention.field-nullification.v1#02"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  rejectWithoutMutation(noFieldState, play("x14-f", "P1", 0, "intervention.field-nullification.v1#02"), "CARD_CONDITION_NOT_MET");

  const opponentDiscardState = makeFixtureState({
    matchId: "fixture-X14-g-opponent-discard",
    hands: { P1: ["attack.steadfast-strike.v1#01"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  rejectWithoutMutation(opponentDiscardState, {
    commandId: "x14-g",
    playerId: "P1",
    expectedRevision: 0,
    commandType: "DISCARD_FOR_ACTION",
    payload: { cardInstanceId: "attack.steadfast-strike.v1#02" },
  }, "CARD_NOT_IN_HAND");

  const nonResponderBase = makeFixtureState({
    matchId: "fixture-X14-h-non-responder",
    hands: { P1: ["attack.rift-pebble.v1#02", "defense.guardian-veil.v1#02"], P2: ["attack.steadfast-strike.v1#02"] },
  });
  const nonResponderAttack = accepted(executeAlpha12Command(nonResponderBase, play("x14-h-attack", "P1", 0, "attack.rift-pebble.v1#02", "P2")));
  rejectWithoutMutation(nonResponderAttack.state, {
    commandId: "x14-h",
    playerId: "P1",
    expectedRevision: nonResponderAttack.state.revision,
    commandType: "SELECT_RESPONSE",
    payload: { cardInstanceId: "defense.guardian-veil.v1#02", responseMode: "RESPONSE" },
  }, "NOT_RESPONDING_PLAYER");
});
