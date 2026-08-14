import test from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_12_RULESET,
  advanceTurnSequence,
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
    matchId: "match-p1-03",
    catalogHash: "catalog.alpha-12.v1",
    engineVersion: "game-core.alpha-12.v1",
    rngAlgorithmVersion: "rng.xoshiro128ss.v1",
    shuffleAlgorithmVersion: "shuffle.fisher-yates-desc.v1",
    seed: "123456789abcdef00fedcba987654321",
    ruleset: ALPHA_12_RULESET,
    players: [
      { playerId: "P1", hand: ["p1-card-01"], hitPoints: 30 },
      { playerId: "P2", hand: ["p2-card-01"], hitPoints: 30 },
    ],
    firstPlayerId: "P1",
    phase: "RESOLUTION",
    cardInstances: [
      card("p1-card-01", "attack.star-breaker.v1", "P1", "HAND", 1),
      card("p2-card-01", "attack.rift-pebble.v1", "P2", "HAND", 2),
      card("draw-01", "attack.steadfast-strike.v1", "P1", "DRAW_PILE", 3),
    ],
    drawPile: ["draw-01"],
    ...overrides,
  });
}

const source = (ownerPlayerId = "P1", cardInstanceId = "p1-card-01", mode = "RELEASE") => ({
  sourceKind: "CARD",
  ownerPlayerId,
  cardDefinitionId: "attack.star-breaker.v1",
  cardInstanceId,
  mode,
});

const effect = (commandType, target, payload, effectId, extra = {}) => ({
  effectId,
  commandType,
  source: source(),
  target,
  payload,
  attributionPolicy: commandType === "DAMAGE_WORLD" || commandType === "RESTORE_WORLD" ? "SOURCE_OWNER" : "NO_LEDGER",
  executionTiming: commandType === "DAMAGE_PLAYER" ? "AFTER_RESPONSE_MODIFIERS" : "IMMEDIATE",
  ...extra,
});

test("75 boundary applies a single next-defense penalty after the queue", () => {
  const result = resolveEffectQueue(makeState({ worldDurability: 79 }), [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 7, reason: "CARD_RELEASE" }, "effect.resolution-0301.0001"),
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.state.world.durability, 72);
  assert.deepEqual(result.state.world.triggeredThresholds, [75]);
  assert.equal(result.state.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.ok(result.events.some((event) => event.type === "WORLD_LAW_EFFECT_APPLIED"));
});

test("50 boundary rewards the last effective world restorer", () => {
  const result = resolveEffectQueue(makeState({ worldDurability: 52 }), [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 2, reason: "CARD_RELEASE" }, "effect.resolution-0302.0001"),
    effect("RESTORE_WORLD", { targetKind: "WORLD" }, { amount: 4, reason: "CARD_RESPONSE" }, "effect.resolution-0302.0002", {
      source: source("P2", "p2-card-01"),
    }),
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.state.world.durability, 54);
  assert.equal(result.state.players.P2.effectiveWorldRestore, 4);
  assert.deepEqual(result.state.players.P1.hand, ["p1-card-01"]);
  assert.deepEqual(result.state.players.P2.hand, ["p2-card-01", "draw-01"]);
  assert.equal(result.state.world.triggeredThresholds.includes(50), true);
});

test("25 boundary activates fragile world only after its reaction", () => {
  const crossing = resolveEffectQueue(makeState({ worldDurability: 27 }), [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 2, reason: "CARD_RELEASE" }, "effect.resolution-0303.0001"),
  ]);
  assert.equal(crossing.committed, true);
  assert.equal(crossing.state.world.durability, 25);
  assert.equal(crossing.state.players.P1.hitPoints, 30);
  assert.equal(crossing.state.players.P1.statusEffects.fragileWorld, true);
  assert.equal(crossing.state.players.P2.statusEffects.fragileWorld, true);
  assert.equal(crossing.results.length, 2);
});

test("fragile-world self damage consumes a normal persistent shield", () => {
  const prepared = makeState({
    worldDurability: 25,
    triggeredThresholds: [25],
    players: [
      { playerId: "P1", hand: ["p1-card-01"], hitPoints: 30, fragileWorld: true },
      { playerId: "P2", hand: ["p2-card-01"], hitPoints: 30, fragileWorld: true },
    ],
  });
  const shielded = {
    ...prepared,
    players: {
      ...prepared.players,
      P1: {
        ...prepared.players.P1,
        statusEffects: {
          ...prepared.players.P1.statusEffects,
          shields: [{ amount: 1, scope: "NEXT_APPLICABLE_ATTACK", pendingAttackId: null, expiresAfterTurnSequence: 3 }],
        },
      },
    },
  };
  const result = resolveEffectQueue(shielded, [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 2, reason: "CARD_RELEASE" }, "effect.resolution-0304.0001"),
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.state.world.durability, 23);
  assert.equal(result.state.players.P1.hitPoints, 29);
  assert.deepEqual(result.state.players.P1.statusEffects.shields, []);
  assert.equal(result.results.length, 2);
});

test("frenzied fracture modifies one card once and root sanctuary modifies one turn once", () => {
  const frenzied = makeState({
    activeField: {
      fieldDefinitionId: "field.frenzied-fracture.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: null,
    },
  });
  const frenzyResult = resolveEffectQueue(frenzied, [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 2, reason: "CARD_RELEASE" }, "effect.resolution-0305.0001"),
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 2, reason: "CARD_RELEASE" }, "effect.resolution-0305.0002"),
  ]);
  assert.equal(frenzyResult.state.world.durability, 95);

  const rooted = makeState({
    activeField: {
      fieldDefinitionId: "field.root-sanctuary.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: null,
    },
  });
  const rootResult = resolveEffectQueue(rooted, [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 1, reason: "CARD_RELEASE" }, "effect.resolution-0305.0003"),
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 3, reason: "CARD_RELEASE" }, "effect.resolution-0305.0004"),
  ]);
  assert.equal(rootResult.state.world.durability, 97);
  assert.equal(rootResult.state.activeField.rootSanctuaryUsedTurnSequence, 1);
});

test("turn advancement removes a field and temporary effects exactly at their expiry", () => {
  const state = makeState({
    turnSequence: 1,
    activeField: {
      fieldDefinitionId: "field.root-sanctuary.v1",
      ownerPlayerId: "P2",
      expiresAfterTurnSequence: 4,
      lastFrenziedCardInstanceId: null,
      rootSanctuaryUsedTurnSequence: 1,
    },
  });
  const next = advanceTurnSequence(state, 3);
  assert.equal(next.activeField?.fieldDefinitionId, "field.root-sanctuary.v1");
  const expired = advanceTurnSequence(next, 4);
  assert.equal(expired.activeField, null);
});

test("ruleset field catalog rejects an unknown field definition", () => {
  const state = makeState();
  const result = resolveEffectQueue(state, [
    effect("SET_FIELD", { targetKind: "CURRENT_FIELD" }, {
      fieldDefinitionId: "field.unknown.v1",
      ownerPlayerId: "P1",
      expiresAfterTurnSequence: 4,
    }, "effect.resolution-0310.0001"),
  ]);
  assert.equal(result.committed, false);
  assert.equal(result.rejectionCode, "EFFECT_CONDITION_NOT_MET");
  assert.equal(result.state, state);
});

test("multiple boundaries run in 75, 50, 25 order and the crossing card avoids fragile self damage", () => {
  const result = resolveEffectQueue(makeState({ worldDurability: 80 }), [
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 60, reason: "CARD_RELEASE" }, "effect.resolution-0306.0001"),
  ]);
  assert.equal(result.committed, true);
  assert.deepEqual(result.state.world.triggeredThresholds, [75, 50, 25]);
  assert.equal(result.state.world.durability, 20);
  assert.equal(result.state.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.equal(result.state.players.P1.hitPoints, 30);
  assert.deepEqual(result.events.filter((event) => event.type === "WORLD_LAW_EFFECT_APPLIED").map((event) => event.details.threshold), [75, 50, 25]);
});

test("normal defeat computes the 72 to 2 judgment", () => {
  const result = resolveEffectQueue(makeState({ players: [
    { playerId: "P1", hand: ["p1-card-01"], hitPoints: 30 },
    { playerId: "P2", hand: ["p2-card-01"], hitPoints: 6 },
  ] }), [
    effect("DAMAGE_PLAYER", { targetKind: "PLAYER", playerId: "P2" }, { amount: 6, damageKind: "DIRECT" }, "effect.resolution-0307.0001", { executionTiming: "IMMEDIATE" }),
  ]);
  assert.equal(result.state.phase, "FINISHED");
  assert.deepEqual(result.state.judgment.playerScores, { P1: 72, P2: 2 });
  assert.equal(result.state.terminalFlags.battleWinnerId, "P1");
  assert.equal(result.state.terminalFlags.divineSelectionWinnerId, "P1");
  assert.equal(result.events.at(-1).type, "MATCH_FINISHED");
});

test("world collapse records the penalty and can coexist with player defeat", () => {
  const result = resolveEffectQueue(makeState({ worldDurability: 80 }), [
    effect("DAMAGE_PLAYER", { targetKind: "PLAYER", playerId: "P2" }, { amount: 30, damageKind: "DIRECT" }, "effect.resolution-0308.0001", { executionTiming: "IMMEDIATE" }),
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 80, reason: "CARD_RELEASE" }, "effect.resolution-0308.0002"),
  ]);
  assert.equal(result.state.phase, "FINISHED");
  assert.equal(result.state.terminalFlags.worldCollapsed, true);
  assert.deepEqual(result.state.world.triggeredThresholds, [75, 50, 25]);
  assert.deepEqual(result.state.judgment.playerScores, { P1: -193, P2: 2 });
  assert.equal(result.state.terminalFlags.divineSelectionWinnerId, "P2");
  assert.equal(result.state.scoreModifiers[0].amount, 25);
});

test("simultaneous reflection and world collapse preserve both defeats", () => {
  let state = makeState({
    worldDurability: 30,
    players: [
      { playerId: "P1", hand: ["p1-card-01"], hitPoints: 10 },
      { playerId: "P2", hand: ["p2-card-01"], hitPoints: 10 },
    ],
  });
  state = beginPendingAttack(state, {
    pendingAttackId: "attack-0309",
    attackingPlayerId: "P1",
    defendingPlayerId: "P2",
    baseDamage: 10,
  });
  const result = resolveEffectQueue(state, [
    effect("DAMAGE_PLAYER", { targetKind: "PLAYER", playerId: "P2" }, { amount: 10, damageKind: "DIRECT" }, "effect.resolution-0309.0001", { executionTiming: "AFTER_RESPONSE_MODIFIERS" }),
    effect("REFLECT_DAMAGE", { targetKind: "PLAYER", playerId: "P1" }, { amount: 10, pendingAttackId: "attack-0309" }, "effect.resolution-0309.0002", { executionTiming: "IMMEDIATE" }),
    effect("DAMAGE_WORLD", { targetKind: "WORLD" }, { amount: 30, reason: "CARD_RELEASE" }, "effect.resolution-0309.0003"),
  ]);
  assert.equal(result.state.terminalFlags.worldCollapsed, true);
  assert.deepEqual(result.state.terminalFlags.defeatedPlayerIds, ["P1", "P2"]);
  assert.equal(result.state.terminalFlags.battleWinnerId, null);
  assert.deepEqual(result.state.judgment.playerScores, { P1: -113, P2: 2 });
  assert.equal(result.state.terminalFlags.divineSelectionWinnerId, "P2");
});
