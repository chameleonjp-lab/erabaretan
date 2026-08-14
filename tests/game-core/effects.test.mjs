import test from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_12_RULESET,
  applyEffect,
  beginPendingAttack,
  createInitialGameState,
  resolveEffectQueue,
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
    matchId: "match-p1-02",
    catalogHash: "catalog.alpha-12.v1",
    engineVersion: "game-core.alpha-12.v1",
    rngAlgorithmVersion: "rng.xoshiro128ss.v1",
    shuffleAlgorithmVersion: "shuffle.fisher-yates-desc.v1",
    seed: "123456789abcdef00fedcba987654321",
    ruleset: ALPHA_12_RULESET,
    players: [
      { playerId: "P1", hand: ["p1-star-01"], hitPoints: 8 },
      { playerId: "P2", hand: ["p2-filler-01"], hitPoints: 30 },
    ],
    firstPlayerId: "P1",
    phase: "RESOLUTION",
    cardInstances: [
      card("p1-star-01", "attack.star-breaker.v1", "P1", "HAND", 1),
      card("p2-filler-01", "attack.steadfast-strike.v1", "P2", "HAND", 2),
      card("draw-01", "attack.rift-pebble.v1", "P1", "DRAW_PILE", 3),
    ],
    drawPile: ["draw-01"],
    ...overrides,
  });
}

const source = (ownerPlayerId = "P1") => ({
  sourceKind: "CARD",
  ownerPlayerId,
  cardDefinitionId: "attack.star-breaker.v1",
  cardInstanceId: "p1-star-01",
  mode: "RELEASE",
});

const effect = (commandType, target, payload, effectId = "effect.resolution-0001.0001", extra = {}) => ({
  effectId,
  commandType,
  source: source(),
  target,
  payload,
  attributionPolicy: commandType === "DAMAGE_WORLD" || commandType === "RESTORE_WORLD" ? "SOURCE_OWNER" : "NO_LEDGER",
  executionTiming: commandType === "DAMAGE_PLAYER" ? "AFTER_RESPONSE_MODIFIERS" : "IMMEDIATE",
  ...extra,
});

function withPendingAttack(state, nextDefensePenalty = 0) {
  const prepared = nextDefensePenalty === 0
    ? state
    : {
        ...state,
        players: {
          ...state.players,
          P2: {
            ...state.players.P2,
            statusEffects: { ...state.players.P2.statusEffects, nextDefensePenalty },
          },
        },
      };
  return beginPendingAttack(prepared, {
    pendingAttackId: "attack-0001",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    baseDamage: 16,
  });
}

test("PAY_HP is separate from damage and does not touch shields or world responsibility", () => {
  const state = makeState();
  const result = applyEffect(state, effect(
    "PAY_HP",
    { targetKind: "PLAYER", playerId: "P1" },
    { amount: 4, minimumRemainingHp: 1 },
  ));
  assert.equal(result.result.status, "APPLIED");
  assert.equal(result.result.effective, 4);
  assert.equal(result.state.players.P1.hitPoints, 4);
  assert.equal(result.state.players.P1.worldDamageResponsibility, 0);
  assert.deepEqual(result.state.players.P1.statusEffects.shields, []);
  assert.deepEqual(result.events.map((event) => event.type), ["PAY_HP_APPLIED"]);
});

test("PAY_HP rejects an insufficient payment atomically", () => {
  const state = makeState();
  const result = applyEffect(state, effect(
    "PAY_HP",
    { targetKind: "PLAYER", playerId: "P1" },
    { amount: 8, minimumRemainingHp: 1 },
  ));
  assert.equal(result.result.status, "REJECTED");
  assert.equal(result.result.rejectionCode, "EFFECT_CONDITION_NOT_MET");
  assert.equal(result.state, state);
});

test("shield and the 75-boundary penalty reduce one incoming attack only", () => {
  let state = withPendingAttack(makeState(), 2);
  const shield = applyEffect(state, effect(
    "ADD_SHIELD",
    { targetKind: "CURRENT_PENDING_ATTACK", pendingAttackId: "attack-0001" },
    { amount: 7, scope: "CURRENT_PENDING_ATTACK", pendingAttackId: "attack-0001" },
  ));
  assert.equal(shield.result.status, "APPLIED");
  state = shield.state;
  const damage = applyEffect(state, effect(
    "DAMAGE_PLAYER",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 16, damageKind: "DIRECT" },
    "effect.resolution-0001.0002",
  ));
  assert.equal(damage.result.effective, 11);
  assert.equal(damage.state.players.P2.hitPoints, 19);
  assert.equal(damage.state.players.P2.statusEffects.nextDefensePenalty, 0);
  assert.equal(damage.state.pendingAttack.currentShield, 0);
  assert.equal(damage.state.pendingAttack.incomingDamageReduction, 0);
});

test("next-attack shields expire after their declared turn and until-turn shields persist", () => {
  let state = makeState();
  const nextShield = applyEffect(state, effect(
    "ADD_SHIELD",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 3, scope: "NEXT_APPLICABLE_ATTACK", expiresAfterTurnSequence: 3 },
  ));
  assert.equal(nextShield.result.status, "APPLIED");
  state = withPendingAttack(nextShield.state);
  const firstDamage = applyEffect(state, effect(
    "DAMAGE_PLAYER",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 16, damageKind: "DIRECT" },
  ));
  assert.equal(firstDamage.result.effective, 13);
  assert.deepEqual(firstDamage.state.players.P2.statusEffects.shields, []);

  const untilShield = applyEffect(makeState(), effect(
    "ADD_SHIELD",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 2, scope: "UNTIL_TURN_SEQUENCE", expiresAfterTurnSequence: 3 },
  ));
  const untilDamage = applyEffect(withPendingAttack(untilShield.state), effect(
    "DAMAGE_PLAYER",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 16, damageKind: "DIRECT" },
  ));
  assert.equal(untilDamage.result.effective, 14);
  assert.equal(untilDamage.state.players.P2.statusEffects.shields.length, 1);
});

test("world damage and restoration record only effective ledger values", () => {
  let state = makeState({ worldDurability: 79 });
  const damage = applyEffect(state, effect(
    "DAMAGE_WORLD",
    { targetKind: "WORLD" },
    { amount: 7, reason: "CARD_RELEASE" },
  ));
  state = damage.state;
  assert.equal(damage.result.effective, 7);
  assert.deepEqual(damage.result.ledgerDelta, {
    ledgerKind: "WORLD_DAMAGE_RESPONSIBILITY",
    playerId: "P1",
    amount: 7,
  });
  assert.equal(state.world.durability, 72);
  assert.deepEqual(state.world.triggeredThresholds, [75]);
  assert.equal(state.players.P1.worldDamageResponsibility, 7);

  const restore = applyEffect(state, effect(
    "RESTORE_WORLD",
    { targetKind: "WORLD" },
    { amount: 7, reason: "CARD_RESPONSE" },
    "effect.resolution-0001.0002",
    { source: { ...source("P2"), cardInstanceId: "p2-filler-01" } },
  ));
  assert.equal(restore.result.effective, 7);
  assert.deepEqual(restore.result.ledgerDelta, {
    ledgerKind: "EFFECTIVE_WORLD_RESTORE",
    playerId: "P2",
    amount: 7,
  });
  assert.equal(restore.state.world.durability, 79);
  assert.equal(restore.state.players.P2.effectiveWorldRestore, 7);
  assert.deepEqual(restore.state.world.triggeredThresholds, [75]);
});

test("world effects honor NO_LEDGER and reject unknown hand owners without throwing", () => {
  const state = makeState({ worldDurability: 90 });
  const noLedger = applyEffect(state, effect(
    "DAMAGE_WORLD",
    { targetKind: "WORLD" },
    { amount: 2, reason: "CARD_RESPONSE" },
    "effect.resolution-0001.0002",
    { attributionPolicy: "NO_LEDGER" },
  ));
  assert.equal(noLedger.result.status, "APPLIED");
  assert.equal(noLedger.state.world.durability, 88);
  assert.equal(noLedger.state.players.P1.worldDamageResponsibility, 0);
  assert.equal(noLedger.result.ledgerDelta, undefined);

  const invalidTarget = applyEffect(state, effect(
    "DRAW_CARD",
    { targetKind: "PLAYER", playerId: "P3" },
    { count: 1, reason: "CARD_EFFECT" },
  ));
  assert.equal(invalidTarget.result.status, "REJECTED");
  assert.equal(invalidTarget.result.rejectionCode, "EFFECT_BAD_TARGET");
  assert.equal(invalidTarget.state, state);
});

test("draw and discard preserve card uniqueness and hand order", () => {
  let state = makeState({
    players: [{ playerId: "P1", hand: [], hitPoints: 8 }, { playerId: "P2", hand: ["p2-filler-01"], hitPoints: 30 }],
    discardPile: ["p1-star-01"],
    cardInstances: [
      card("p1-star-01", "attack.star-breaker.v1", "P1", "DISCARD_PILE", 1),
      card("p2-filler-01", "attack.steadfast-strike.v1", "P2", "HAND", 2),
      card("draw-01", "attack.rift-pebble.v1", "P1", "DRAW_PILE", 3),
    ],
  });
  const draw = applyEffect(state, effect(
    "DRAW_CARD",
    { targetKind: "PLAYER", playerId: "P1" },
    { count: 1, reason: "CARD_EFFECT" },
  ));
  state = draw.state;
  assert.equal(draw.result.effective, 1);
  assert.deepEqual(state.players.P1.hand, ["draw-01"]);
  assert.equal(state.cardInstances["draw-01"].ownerPlayerId, "P1");

  const discard = applyEffect(state, effect(
    "DISCARD_CARD",
    { targetKind: "PLAYER", playerId: "P1" },
    { selection: { selectionKind: "NEWEST_CARD_INSTANCE" }, reason: "CARD_EFFECT" },
    "effect.resolution-0001.0002",
  ));
  assert.equal(discard.result.status, "APPLIED");
  assert.deepEqual(discard.state.players.P1.hand, []);
  assert.deepEqual(discard.state.cardZones.discardPile, ["p1-star-01", "draw-01"]);
});

test("an effect queue is atomic when a later PAY_HP cannot be paid", () => {
  const state = makeState();
  const result = resolveEffectQueue(state, [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 7, reason: "CARD_RELEASE" }),
    effect("PAY_HP", { targetKind: "PLAYER", playerId: "P1" }, { amount: 8, minimumRemainingHp: 1 }, "effect.resolution-0001.0002"),
  ]);
  assert.equal(result.committed, false);
  assert.equal(result.rejectionCode, "EFFECT_CONDITION_NOT_MET");
  assert.equal(result.state, state);
  assert.deepEqual(result.events, []);
  assert.equal(result.results[0].status, "APPLIED");
  assert.equal(result.results[1].status, "REJECTED");
});

test("reflection applies once and does not open a second response", () => {
  let state = withPendingAttack(makeState());
  const damage = applyEffect(state, effect(
    "DAMAGE_PLAYER",
    { targetKind: "PLAYER", playerId: "P2" },
    { amount: 16, damageKind: "DIRECT" },
  ));
  state = damage.state;
  const reflect = applyEffect(state, effect(
    "REFLECT_DAMAGE",
    { targetKind: "PLAYER", playerId: "P1" },
    { amount: 4, pendingAttackId: "attack-0001" },
    "effect.resolution-0001.0002",
  ));
  assert.equal(reflect.result.status, "APPLIED");
  assert.equal(reflect.state.players.P1.hitPoints, 4);
  assert.equal(reflect.state.pendingAttack.reflectionApplied, true);
  const again = applyEffect(reflect.state, effect(
    "REFLECT_DAMAGE",
    { targetKind: "PLAYER", playerId: "P1" },
    { amount: 4, pendingAttackId: "attack-0001" },
    "effect.resolution-0001.0003",
  ));
  assert.equal(again.result.status, "REJECTED");
  assert.equal(again.result.rejectionCode, "EFFECT_CONDITION_NOT_MET");
  assert.equal(again.state, reflect.state);
});
