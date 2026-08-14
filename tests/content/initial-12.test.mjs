import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_12_CARD_DEFINITIONS,
  buildInitial12CardEffects,
} from "../../packages/content/src/index.ts";

const baseInput = {
  resolutionId: "resolution-0001",
  cardInstanceId: "p1-card-01",
  ownerPlayerId: "P1",
  targetPlayerId: "P2",
  turnSequence: 4,
};

test("initial content contains twelve versioned card definitions", () => {
  assert.equal(INITIAL_12_CARD_DEFINITIONS.length, 12);
  assert.equal(new Set(INITIAL_12_CARD_DEFINITIONS.map((card) => card.cardDefinitionId)).size, 12);
  assert.ok(INITIAL_12_CARD_DEFINITIONS.every((card) => card.cardVersion === 1 && card.copiesInDeck === 3));
});

test("oath of renewal expands to PAY_HP before RESTORE_WORLD", () => {
  const effects = buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "intervention.oath-of-renewal.v1",
    mode: "RELEASE",
  });
  assert.deepEqual(effects.map((effect) => effect.commandType), ["PAY_HP", "RESTORE_WORLD"]);
  assert.equal(effects[0].effectId, "effect.resolution-0001.0001");
  assert.deepEqual(effects[0].target, { targetKind: "PLAYER", playerId: "P1" });
  assert.deepEqual(effects[1].target, { targetKind: "WORLD" });
});

test("star breaker release preserves damage ordering and restrain expiry", () => {
  const release = buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "attack.star-breaker.v1",
    mode: "RELEASE",
  });
  assert.deepEqual(release.map((effect) => effect.commandType), ["DAMAGE_PLAYER", "DAMAGE_WORLD"]);
  assert.equal(release[0].executionTiming, "AFTER_RESPONSE_MODIFIERS");
  assert.equal(release[1].executionTiming, "IMMEDIATE");

  const restrain = buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "attack.star-breaker.v1",
    mode: "RESTRAIN",
  });
  assert.equal(restrain[0].commandType, "ADD_SHIELD");
  assert.equal(restrain[0].payload.scope, "NEXT_APPLICABLE_ATTACK");
  assert.equal(restrain[0].payload.expiresAfterTurnSequence, 6);
});

test("response shield targets the current pending attack explicitly", () => {
  const effects = buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "defense.guardian-veil.v1",
    mode: "RESPONSE",
    pendingAttackId: "attack-0007",
  });
  assert.deepEqual(effects[0].target, { targetKind: "CURRENT_PENDING_ATTACK", pendingAttackId: "attack-0007" });
  assert.equal(effects[0].payload.pendingAttackId, "attack-0007");
});

test("response effects require a pending attack id", () => {
  assert.throws(() => buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "defense.guardian-veil.v1",
    mode: "RESPONSE",
  }), /pendingAttackId/);
});
