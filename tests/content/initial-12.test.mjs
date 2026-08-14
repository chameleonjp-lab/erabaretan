import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_12_CARD_DEFINITIONS,
  buildInitial12CardEffects,
  initial12CommandValidationOptions,
  validateInitial12CardPlay,
} from "../../packages/content/src/index.ts";
import { ALPHA_12_RULESET, applyCommand, beginPendingAttack, createInitialGameState } from "../../packages/game-core/src/index.ts";

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
  assert.ok(INITIAL_12_CARD_DEFINITIONS.every((card) => card.cardVersion === 1 && card.copiesInDeck === 3 && card.introducedRulesetId === "ruleset.alpha-12.v1"));
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

test("star-breaker restrain does not require an opponent target", () => {
  const validation = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "attack.star-breaker.v1" }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RESTRAIN",
  });
  assert.equal(validation.ok, true);
});

test("careful-redraw can carry an explicit different hand card into its discard effect", () => {
  const effects = buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "intervention.careful-redraw.v1",
    mode: "RELEASE",
    discardCardInstanceId: "other-card-01",
  });
  assert.deepEqual(effects[0].payload.selection, {
    selectionKind: "EXPLICIT_CARD_INSTANCE",
    cardInstanceId: "other-card-01",
  });
  assert.throws(() => buildInitial12CardEffects({
    ...baseInput,
    cardDefinitionId: "intervention.careful-redraw.v1",
    mode: "RELEASE",
    discardCardInstanceId: "p1-card-01",
  }), /differ/);
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

function conditionState({ cardDefinitionId, hitPoints = 30, worldDurability = 80, p2Responsibility = 0, hand = ["card-01"], activeField = null, phase = "ACTION_SELECTION", extraCards = [] } = {}) {
  return createInitialGameState({
    matchId: "match-content-conditions",
    catalogHash: "catalog.alpha-12.v1",
    engineVersion: "game-core.alpha-12.v1",
    rngAlgorithmVersion: "fixture-no-rng.v1",
    shuffleAlgorithmVersion: "fixture-prepared-deck.v1",
    seed: "seed",
    ruleset: ALPHA_12_RULESET,
    players: [
      { playerId: "P1", hand, hitPoints },
      { playerId: "P2", hand: ["p2-card-01"], worldDamageResponsibility: p2Responsibility },
    ],
    firstPlayerId: "P1",
    phase,
    worldDurability,
    activeField,
    cardInstances: [
      { cardInstanceId: "card-01", cardDefinitionId, ownerPlayerId: "P1", zone: "HAND", drawOrder: 1 },
      { cardInstanceId: "p2-card-01", cardDefinitionId: "attack.steadfast-strike.v1", ownerPlayerId: "P2", zone: "HAND", drawOrder: 2 },
      ...extraCards,
    ],
    drawPile: [],
  });
}

test("card conditions reject oath, judgment, nullification, and redraw edge cases", () => {
  const oathLowHp = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.oath-of-renewal.v1", hitPoints: 4 }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
  });
  assert.equal(oathLowHp.ok, false);
  assert.equal(oathLowHp.code, "CONDITION_NOT_MET");

  const oathFullWorld = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.oath-of-renewal.v1", worldDurability: 100 }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
  });
  assert.equal(oathFullWorld.ok, false);

  const judgmentBlocked = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.judgment-of-scars.v1", p2Responsibility: 4 }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
    targetPlayerId: "P2",
  });
  assert.equal(judgmentBlocked.ok, false);

  const nullificationWithoutField = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.field-nullification.v1" }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
  });
  assert.equal(nullificationWithoutField.ok, false);

  const redrawWithOneCard = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.careful-redraw.v1", hand: ["card-01"] }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
  });
  assert.equal(redrawWithOneCard.ok, false);

  const redrawOtherCard = validateInitial12CardPlay({
    state: conditionState({
      cardDefinitionId: "intervention.careful-redraw.v1",
      hand: ["card-01", "other-card-01"],
      extraCards: [{ cardInstanceId: "other-card-01", cardDefinitionId: "attack.rift-pebble.v1", ownerPlayerId: "P1", zone: "HAND", drawOrder: 3 }],
    }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
    discardCardInstanceId: "other-card-01",
  });
  assert.equal(redrawOtherCard.ok, true);

  const redrawSelfCard = validateInitial12CardPlay({
    state: conditionState({
      cardDefinitionId: "intervention.careful-redraw.v1",
      hand: ["card-01", "other-card-01"],
      extraCards: [{ cardInstanceId: "other-card-01", cardDefinitionId: "attack.rift-pebble.v1", ownerPlayerId: "P1", zone: "HAND", drawOrder: 3 }],
    }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
    discardCardInstanceId: "card-01",
  });
  assert.equal(redrawSelfCard.ok, false);
});

test("card conditions accept a valid judgment and field nullification play", () => {
  const judgment = validateInitial12CardPlay({
    state: conditionState({ cardDefinitionId: "intervention.judgment-of-scars.v1", p2Responsibility: 5 }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
    targetPlayerId: "P2",
  });
  assert.equal(judgment.ok, true);

  const nullification = validateInitial12CardPlay({
    state: conditionState({
      cardDefinitionId: "intervention.field-nullification.v1",
      activeField: {
        fieldDefinitionId: "field.root-sanctuary.v1",
        ownerPlayerId: "P2",
        expiresAfterTurnSequence: 4,
        lastFrenziedCardInstanceId: null,
        rootSanctuaryUsedTurnSequence: null,
      },
    }),
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RELEASE",
  });
  assert.equal(nullification.ok, true);
});

test("response card conditions require the live pending attack to match", () => {
  const baseState = conditionState({ cardDefinitionId: "defense.guardian-veil.v1" });
  const resolutionState = { ...baseState, phase: "RESOLUTION" };
  const withAttack = beginPendingAttack(resolutionState, {
    pendingAttackId: "attack-content-01",
    attackingPlayerId: "P2",
    defendingPlayerId: "P1",
    baseDamage: 6,
  });
  const mismatched = validateInitial12CardPlay({
    state: {
      ...withAttack,
      phase: "RESPONSE_SELECTION",
      respondingPlayerId: "P1",
      pendingAction: {
        kind: "RESPONSE_SELECTION",
        pendingAttackId: "attack-content-other",
        commandId: "command-content-01",
        attackingPlayerId: "P2",
        defendingPlayerId: "P1",
        cardInstanceId: "card-01",
        cardDefinitionId: "defense.guardian-veil.v1",
        playMode: "RELEASE",
        targetPlayerId: "P2",
      },
    },
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RESPONSE",
  });
  assert.equal(mismatched.ok, false);

  const matching = validateInitial12CardPlay({
    state: {
      ...withAttack,
      phase: "RESPONSE_SELECTION",
      respondingPlayerId: "P1",
      pendingAction: {
        kind: "RESPONSE_SELECTION",
        pendingAttackId: "attack-content-01",
        commandId: "command-content-01",
        attackingPlayerId: "P2",
        defendingPlayerId: "P1",
        cardInstanceId: "card-01",
        cardDefinitionId: "defense.guardian-veil.v1",
        playMode: "RELEASE",
        targetPlayerId: "P2",
      },
    },
    playerId: "P1",
    cardInstanceId: "card-01",
    mode: "RESPONSE",
  });
  assert.equal(matching.ok, true);
});

test("initial-12 condition adapter can be applied to generic command validation", () => {
  const state = conditionState({ cardDefinitionId: "intervention.oath-of-renewal.v1", hitPoints: 4 });
  const result = applyCommand(state, {
    commandId: "condition-command-01",
    playerId: "P1",
    expectedRevision: 0,
    commandType: "PLAY_CARD",
    payload: { cardInstanceId: "card-01", playMode: "RELEASE" },
  }, initial12CommandValidationOptions);
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "CARD_CONDITION_NOT_MET");
  assert.equal(result.state, state);
});

test("careful-redraw command validation carries an explicit discard selection", () => {
  const state = conditionState({
    cardDefinitionId: "intervention.careful-redraw.v1",
    hand: ["card-01", "other-card-01"],
    extraCards: [{ cardInstanceId: "other-card-01", cardDefinitionId: "attack.rift-pebble.v1", ownerPlayerId: "P1", zone: "HAND", drawOrder: 3 }],
  });
  const accepted = applyCommand(state, {
    commandId: "condition-redraw-01",
    playerId: "P1",
    expectedRevision: 0,
    commandType: "PLAY_CARD",
    payload: {
      cardInstanceId: "card-01",
      playMode: "RELEASE",
      discardCardInstanceId: "other-card-01",
    },
  }, initial12CommandValidationOptions);
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) assert.equal(accepted.state.pendingAction?.discardCardInstanceId, "other-card-01");

  const missing = applyCommand(state, {
    commandId: "condition-redraw-02",
    playerId: "P1",
    expectedRevision: 0,
    commandType: "PLAY_CARD",
    payload: { cardInstanceId: "card-01", playMode: "RELEASE" },
  }, initial12CommandValidationOptions);
  assert.equal(missing.accepted, false);
  assert.equal(missing.error.code, "CARD_CONDITION_NOT_MET");
});
