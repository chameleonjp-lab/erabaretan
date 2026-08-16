import test from "node:test";
import assert from "node:assert/strict";
import {
  ALPHA_12_CPU_POLICY_ID,
  ALPHA_12_SIMULATION_VERSION,
  INITIAL_12_CARD_DEFINITIONS,
  runAlpha12Simulation,
} from "../../packages/content/src/index.ts";

const seeds = [
  "123456789abcdef00fedcba987654321",
  "fedcba98765432100123456789abcdef",
  "00112233445566778899aabbccddeeff",
];

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test("P4-02 records deterministic public-state CPU matches and aggregate metrics", () => {
  const first = runAlpha12Simulation({ seeds, matchIdPrefix: "p4-02-metrics" });
  const second = runAlpha12Simulation({ seeds, matchIdPrefix: "p4-02-metrics" });

  assert.deepEqual(first, second, "same seeds, match ids, and policy must reproduce the full report");
  assert.equal(first.simulationVersion, ALPHA_12_SIMULATION_VERSION);
  assert.equal(first.cpuPolicyId, ALPHA_12_CPU_POLICY_ID);
  assert.equal(first.matches.length, seeds.length);
  assert.equal(first.metrics.matchCount, seeds.length);
  assert.equal(first.metrics.endKindCounts.NORMAL, seeds.length);
  assert.equal(first.metrics.endKindCounts.INVALID_MATCH, 0);
  assert.equal(first.metrics.endKindCounts.SERVER_ABORT, 0);

  for (const [index, match] of first.matches.entries()) {
    assert.equal(match.matchIndex, index);
    assert.equal(match.seed, seeds[index]);
    assert.equal(match.matchId, `p4-02-metrics.${String(index + 1).padStart(4, "0")}`);
    assert.equal(match.rulesetId, "ruleset.alpha-12.v1");
    assert.equal(match.cpuPolicyId, ALPHA_12_CPU_POLICY_ID);
    assert.equal(match.endKind, "NORMAL");
    assert.match(match.finalStateHash, /^[0-9a-f]{64}$/);
    assert.equal(match.rounds, Math.min(Math.max(match.finalRoundNumber - 1, 0), 10));
    assert.equal(match.playedCardCount, match.releaseCount + match.restrainCount);
    assert.equal(match.cardUseCount, sum(Object.values(match.cardUsage)));
    assert.ok(match.finalRoundNumber >= match.rounds);
    assert.ok(match.thresholdRounds[75] === null || match.thresholdRounds[75] >= 1);
    assert.ok(match.thresholdRounds[50] === null || match.thresholdRounds[75] !== null);
    assert.ok(match.thresholdRounds[25] === null || match.thresholdRounds[50] !== null);
    assert.ok(match.oathOfRenewalSurvivalCount <= match.oathOfRenewalUseCount);
  }

  const metrics = first.metrics;
  assert.equal(metrics.playedCardCount, sum(first.matches.map((match) => match.playedCardCount)));
  assert.equal(metrics.cardUseCount, sum(first.matches.map((match) => match.cardUseCount)));
  assert.equal(metrics.releaseCount + metrics.restrainCount, metrics.playedCardCount);
  assert.equal(metrics.actionDecisionCount, metrics.playedCardCount + metrics.discardForActionCount);
  assert.equal(metrics.discardForActionRate, metrics.discardForActionCount / metrics.actionDecisionCount);
  assert.equal(sum(Object.values(metrics.cardUsage).map((usage) => usage.count)), metrics.cardUseCount);
  assert.ok(Math.abs(sum(Object.values(metrics.cardUsage).map((usage) => usage.rate)) - 1) < 1e-12);
  assert.equal(
    metrics.oathOfRenewalSurvivalRate,
    metrics.oathOfRenewalSurvivalCount / metrics.oathOfRenewalUseCount,
  );
});

test("P4-02 makes zero-denominator metrics explicit for an empty seed run", () => {
  const report = runAlpha12Simulation({ seeds: [] });
  assert.equal(report.matches.length, 0);
  assert.equal(report.metrics.matchCount, 0);
  assert.equal(report.metrics.averageRounds, null);
  assert.equal(report.metrics.worldCollapseRate, null);
  assert.equal(report.metrics.maxRoundsRate, null);
  assert.equal(report.metrics.releaseRate, null);
  assert.equal(report.metrics.restrainRate, null);
  assert.equal(report.metrics.firstPlayerDivineSelectionRate, null);
  assert.equal(report.metrics.battleDivineAgreementRate, null);
  assert.equal(report.metrics.oathOfRenewalUseRate, null);
  assert.equal(report.metrics.oathOfRenewalSurvivalRate, null);
  assert.equal(report.metrics.discardForActionRate, null);
  assert.ok(INITIAL_12_CARD_DEFINITIONS.every((definition) => (
    report.metrics.cardUsage[definition.cardDefinitionId].count === 0
    && report.metrics.cardUsage[definition.cardDefinitionId].rate === null
  )));
});

test("P4-02 reports threshold reach in first-crossing round order", () => {
  const report = runAlpha12Simulation({ seeds });
  for (const match of report.matches) {
    const { 75: threshold75, 50: threshold50, 25: threshold25 } = match.thresholdRounds;
    if (threshold50 !== null) assert.ok(threshold75 !== null && threshold75 <= threshold50);
    if (threshold25 !== null) assert.ok(threshold50 !== null && threshold50 <= threshold25);
  }
});
