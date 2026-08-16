import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectPublicFactBatch, composeResultJudgment } from "../../web/src/result-summary.ts";

function summary(overrides = {}) {
  return {
    summaryVersion: "match-summary.alpha-12.v1",
    matchId: "p3-04-summary",
    endKind: "NORMAL",
    normalEndReasons: ["PLAYER_DEFEATED"],
    battle: { status: "WINNER", winnerId: "P2" },
    divineSelection: { status: "SELECTED", winnerId: "P2" },
    scoreStatus: "FINAL",
    players: [
      { playerId: "P1", score: 2, survivalEvaluation: 40, worldEvaluation: -38, worldDamageResponsibility: 13, effectiveWorldRestore: 0, causedWorldCollapse: false },
      { playerId: "P2", score: 72, survivalEvaluation: 40, worldEvaluation: 32, worldDamageResponsibility: 0, effectiveWorldRestore: 4, causedWorldCollapse: false },
    ],
    world: { durability: 72, maxDurability: 100, collapsed: false, collapseResponsiblePlayerId: null },
    ...overrides,
  };
}

test("P3-04 converts only public effect facts and drops secret/card data", () => {
  const batch = collectPublicFactBatch([
    { type: "DAMAGE_WORLD_APPLIED", effectId: "effect.secret.0001", commandType: "DAMAGE_WORLD", details: { ownerPlayerId: "P1", effective: 7, cardInstanceId: "hidden-card" } },
    { type: "RESTORE_WORLD_APPLIED", details: { ownerPlayerId: "P2", effective: 4 } },
    { type: "CARD_DISCARDED", details: { cardInstanceId: "hidden-card", playerId: "P1" } },
    { type: "DRAW_CARD", details: { playerId: "P2", cardInstanceId: "drawn-card" } },
    { type: "DAMAGE_WORLD_APPLIED", details: { ownerPlayerId: "unknown", effective: 99 } },
  ], ["P1", "P2"]);

  assert.deepEqual(batch.facts, [
    { type: "WORLD_DAMAGED", playerId: "P1", amount: 7 },
    { type: "WORLD_RESTORED", playerId: "P2", amount: 4 },
  ]);
  assert.equal(JSON.stringify(batch).includes("hidden-card"), false);
  assert.equal(JSON.stringify(batch).includes("effect.secret"), false);
});

test("P3-04 selects at most three non-duplicated turning-point batches in time order", () => {
  const batches = [
    collectPublicFactBatch([
      { type: "DAMAGE_WORLD_APPLIED", details: { ownerPlayerId: "P1", effective: 3 } },
      { type: "WORLD_THRESHOLD_TRIGGERED", details: { threshold: 75 } },
    ], ["P1", "P2"]),
    collectPublicFactBatch([
      { type: "RESTORE_WORLD_APPLIED", details: { ownerPlayerId: "P2", effective: 6 } },
    ], ["P1", "P2"]),
    collectPublicFactBatch([
      { type: "DAMAGE_WORLD_APPLIED", details: { ownerPlayerId: "P1", effective: 10 } },
      { type: "PLAYER_DEFEATED", details: { playerId: "P2" } },
      { type: "WORLD_COLLAPSED", details: { worldDurability: 0 } },
    ], ["P1", "P2"]),
  ];

  const result = composeResultJudgment(summary({
    normalEndReasons: ["PLAYER_DEFEATED", "WORLD_COLLAPSED"],
    world: { durability: 0, maxDurability: 100, collapsed: true, collapseResponsiblePlayerId: "P1" },
  }), batches);

  assert.equal(result.turningPoints.length, 3);
  assert.deepEqual(result.turningPoints.map((point) => point.batchIndex), [0, 1, 2]);
  assert.deepEqual(result.turningPoints.map((point) => point.kind), ["WORLD_DAMAGE", "WORLD_RESTORE", "WORLD_COLLAPSED"]);
  assert.equal(result.turningPoints.filter((point) => point.batchIndex === 2).length, 1);
  assert.equal(result.turningPoints.find((point) => point.kind === "WORLD_COLLAPSED")?.amount, 10);
});

test("P3-04 falls back to terminal facts when no event batch was retained", () => {
  const maxRounds = composeResultJudgment(summary({
    normalEndReasons: ["MAX_ROUNDS_REACHED"],
    battle: { status: "DRAW", winnerId: null },
    divineSelection: { status: "TIE", winnerId: null },
  }), []);
  assert.deepEqual(maxRounds.turningPoints.map((point) => point.kind), ["MAX_ROUNDS_REACHED"]);

  const surrender = composeResultJudgment(summary({
    endKind: "SURRENDER",
    normalEndReasons: [],
    battle: { status: "WINNER", winnerId: "P2" },
    divineSelection: { status: "NOT_AWARDED", winnerId: null },
    scoreStatus: "NOT_AWARDED",
    players: [
      { playerId: "P1", score: null, survivalEvaluation: null, worldEvaluation: null, worldDamageResponsibility: 0, effectiveWorldRestore: 0, causedWorldCollapse: false },
      { playerId: "P2", score: null, survivalEvaluation: null, worldEvaluation: null, worldDamageResponsibility: 0, effectiveWorldRestore: 0, causedWorldCollapse: false },
    ],
  }), []);
  assert.deepEqual(surrender.turningPoints.map((point) => point.kind), ["SURRENDER"]);
  assert.deepEqual(surrender.turningPoints[0].playerIds, ["P1"]);
});

test("P3-04 prioritizes the decisive batch before chronological display order", () => {
  const batches = [
    collectPublicFactBatch([{ type: "WORLD_THRESHOLD_TRIGGERED", details: { threshold: 75 } }], ["P1", "P2"]),
    collectPublicFactBatch([{ type: "DAMAGE_WORLD_APPLIED", details: { ownerPlayerId: "P1", effective: 8 } }], ["P1", "P2"]),
    collectPublicFactBatch([{ type: "RESTORE_WORLD_APPLIED", details: { ownerPlayerId: "P2", effective: 5 } }], ["P1", "P2"]),
    collectPublicFactBatch([{ type: "PLAYER_DEFEATED", details: { playerId: "P1" } }], ["P1", "P2"]),
  ];
  const result = composeResultJudgment(summary(), batches);
  assert.deepEqual(result.turningPoints.map((point) => point.kind), ["WORLD_DAMAGE", "WORLD_RESTORE", "PLAYER_DEFEATED"]);
  assert.deepEqual(result.turningPoints.map((point) => point.batchIndex), [1, 2, 3]);
});

test("P3-04 keeps the result DOM order aligned with the specification", () => {
  const source = readFileSync(new URL("../../web/src/main.ts", import.meta.url), "utf8");
  const positions = [
    source.indexOf('class="result-reason"'),
    source.indexOf("戦闘勝者"),
    source.indexOf('class="score-table"'),
    source.indexOf("renderTurningPoints(resultJudgment.turningPoints)"),
    source.indexOf("result-selection"),
    source.indexOf("data-rematch"),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});
