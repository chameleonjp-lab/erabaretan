import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import {
  INITIAL_12_CARD_BY_ID,
  createAlpha12Setup,
  executeAlpha12Command,
  runAlpha12Simulation,
} from "../../packages/content/src/index.ts";
import {
  P4_03_H2_CATALOG,
  P4_03_H2_CANDIDATE_ID,
  P4_03_H2_PROFILE,
  P4_03_H2_WORLD_DAMAGE_FROM,
  P4_03_H2_WORLD_DAMAGE_TO,
  runP403H2Simulation,
} from "../../packages/content/src/balance/p4-03-h2.ts";
import {
  calculateJudgmentBreakdown,
  createReplayRecord,
  finalizeTerminalState,
  hashGameState,
  verifyReplay,
} from "../../packages/game-core/src/index.ts";

const seeds = Array.from({ length: 1024 }, (_, index) => (
  (index + 1).toString(16).padStart(32, "0")
));

const options = { seeds, matchIdPrefix: "p4-03-h2-gate" };
const baselineSnapshot = JSON.parse(readFileSync(
  new URL("../fixtures/p4-03-h2/p4-03-h2-v1-baseline.json", import.meta.url),
));
const candidateSnapshot = JSON.parse(readFileSync(
  new URL("../fixtures/p4-03-h2/p4-03-h2-candidate.json", import.meta.url),
));

function snapshotMatchFacts(result) {
  return {
    finalStateHashes: result.matches.map((match) => match.finalStateHash),
    endKinds: result.matches.map((match) => match.endKind),
    firstPlayerIds: result.matches.map((match) => match.firstPlayerId),
    rounds: result.matches.map((match) => match.rounds),
    thresholdRounds: {
      75: result.matches.map((match) => match.thresholdRounds[75]),
      50: result.matches.map((match) => match.thresholdRounds[50]),
      25: result.matches.map((match) => match.thresholdRounds[25]),
    },
    maxRoundsReached: result.matches.map((match) => match.maxRoundsReached),
  };
}

test("P4-03 H2 changes only star-breaker's RELEASE world damage", () => {
  const v1 = INITIAL_12_CARD_BY_ID["attack.star-breaker.v1"];
  const h2 = P4_03_H2_CATALOG.byId["attack.star-breaker.v1"];
  assert.ok(v1);
  assert.ok(h2);
  assert.equal(v1.modes.RELEASE[0].payload.amount, 16);
  assert.equal(v1.modes.RELEASE[1].payload.amount, P4_03_H2_WORLD_DAMAGE_FROM);
  assert.equal(h2.modes.RELEASE[0].payload.amount, 16);
  assert.equal(h2.modes.RELEASE[1].payload.amount, P4_03_H2_WORLD_DAMAGE_TO);
  assert.deepEqual(h2.modes.RESTRAIN, v1.modes.RESTRAIN);
  assert.equal(P4_03_H2_PROFILE.cpuPolicyId, "public-greedy-v1");
  assert.equal(P4_03_H2_PROFILE.ruleset.rulesetId, P4_03_H2_CANDIDATE_ID);
  assert.equal(P4_03_H2_PROFILE.ruleset.maxRounds, 10);
  assert.equal(P4_03_H2_PROFILE.ruleset.worldDamageScoreMultiplier, -3);
});

test("P4-03 H2 preserves the world-83 boundary probe at 76 versus 75", () => {
  const resolveStar = (candidate) => {
    const setup = createAlpha12Setup({
      matchId: candidate ? "p4-03-h2-candidate-boundary" : "p4-03-h2-v1-boundary",
      seed: "00000000000000000000000000000001",
      ...(candidate ? {
        catalog: P4_03_H2_CATALOG,
        ruleset: P4_03_H2_PROFILE.ruleset,
        catalogHash: P4_03_H2_PROFILE.catalogHash,
        engineVersion: P4_03_H2_PROFILE.engineVersion,
      } : {}),
    });
    const cardInstanceId = setup.hands.P1.find((id) => id.startsWith("attack.star-breaker.v1#"));
    assert.ok(cardInstanceId);
    const state = {
      ...setup.state,
      activePlayerId: "P1",
      world: { ...setup.state.world, durability: 83 },
    };
    const executorArgs = candidate
      ? [P4_03_H2_PROFILE.validationOptions, P4_03_H2_CATALOG]
      : [];
    const played = executeAlpha12Command(state, {
      commandId: candidate ? "p4-03-h2-boundary-play" : "p4-03-v1-boundary-play",
      playerId: "P1",
      expectedRevision: state.revision,
      commandType: "PLAY_CARD",
      payload: { cardInstanceId, playMode: "RELEASE", targetPlayerId: "P2" },
    }, ...executorArgs);
    assert.equal(played.accepted, true);
    const resolved = executeAlpha12Command(played.state, {
      commandId: candidate ? "p4-03-h2-boundary-accept" : "p4-03-v1-boundary-accept",
      playerId: "P2",
      expectedRevision: played.state.revision,
      commandType: "ACCEPT_DAMAGE",
      payload: {},
    }, ...executorArgs);
    assert.equal(resolved.accepted, true);
    return resolved.state.world;
  };

  const v1World = resolveStar(false);
  const h2World = resolveStar(true);
  assert.equal(v1World.durability, 76);
  assert.deepEqual(v1World.triggeredThresholds, []);
  assert.equal(h2World.durability, 75);
  assert.deepEqual(h2World.triggeredThresholds, [75]);
});

test("P4-03 H2 keeps the TURN_START max-round terminal boundary", () => {
  const report = runP403H2Simulation({
    seeds: ["00000000000000000000000000000008"],
    matchIdPrefix: "p4-03-h2-turn-start-max-round",
  });
  const [match] = report.matches;
  assert.equal(match.endKind, "NORMAL");
  assert.equal(match.maxRoundsReached, true);
  assert.equal(match.rounds, 10);
  assert.equal(match.finalRoundNumber, 11);
  assert.equal(match.playedCardCount, 20);
  assert.equal(match.actionDecisionCount, 20);
  assert.equal(match.cardUseCount, 25);
  assert.equal(match.finalStateHash, "e2b20d1799fcbc71a0458b97123db6ffd9f5a9561b745ada7dca7efba783fe26");
});

test("P4-03 H2 preserves world responsibility, scoring, and candidate replay metadata", () => {
  const seed = "00000000000000000000000000000001";
  const makeScenario = (candidate) => {
    const setup = createAlpha12Setup({
      matchId: candidate ? "p4-03-h2-replay-candidate" : "p4-03-h2-replay-v1",
      seed,
      ...(candidate ? {
        catalog: P4_03_H2_CATALOG,
        ruleset: P4_03_H2_PROFILE.ruleset,
        catalogHash: P4_03_H2_PROFILE.catalogHash,
        engineVersion: P4_03_H2_PROFILE.engineVersion,
      } : {}),
    });
    const cardInstanceId = setup.hands.P1.find((id) => id.startsWith("attack.star-breaker.v1#"));
    assert.ok(cardInstanceId);
    const initialState = {
      ...setup.state,
      activePlayerId: "P1",
      world: { ...setup.state.world, durability: 83 },
    };
    const executorArgs = candidate
      ? [P4_03_H2_PROFILE.validationOptions, P4_03_H2_CATALOG]
      : [];
    const commands = [
      {
        commandId: candidate ? "p4-03-h2-replay-play" : "p4-03-v1-replay-play",
        playerId: "P1",
        expectedRevision: initialState.revision,
        commandType: "PLAY_CARD",
        payload: { cardInstanceId, playMode: "RELEASE", targetPlayerId: "P2" },
      },
      {
        commandId: candidate ? "p4-03-h2-replay-accept" : "p4-03-v1-replay-accept",
        playerId: "P2",
        expectedRevision: initialState.revision + 1,
        commandType: "ACCEPT_DAMAGE",
        payload: {},
      },
    ];
    const execute = (state, command) => executeAlpha12Command(state, command, ...executorArgs);
    const played = execute(initialState, commands[0]);
    assert.equal(played.accepted, true);
    const resolved = execute(played.state, commands[1]);
    assert.equal(resolved.accepted, true);
    return { initialState, finalState: resolved.state, commands, execute };
  };

  const v1 = makeScenario(false);
  const h2 = makeScenario(true);
  assert.equal(h2.finalState.players.P1.worldDamageResponsibility, 8);
  assert.equal(h2.finalState.players.P1.statusEffects.nextDefensePenalty, 2);
  assert.equal(h2.finalState.ruleset.worldDamageScoreMultiplier, -3);

  const h2Finished = finalizeTerminalState({ ...h2.finalState, roundNumber: 11 });
  const h2Breakdown = calculateJudgmentBreakdown(h2Finished);
  assert.equal(h2Breakdown.breakdown.P1.worldEvaluation, -24);
  assert.equal(h2Breakdown.judgment.playerScores.P1, 48);
  const v1Finished = finalizeTerminalState({ ...v1.finalState, roundNumber: 11 });
  const v1Breakdown = calculateJudgmentBreakdown(v1Finished);
  assert.equal(v1Breakdown.breakdown.P1.worldEvaluation, -21);

  const h2Replay = createReplayRecord(h2.initialState, h2.commands, h2.finalState, {
    executeCommand: h2.execute,
  });
  const verified = verifyReplay(h2.initialState, h2Replay, { executeCommand: h2.execute });
  assert.equal(verified.ok, true);
  assert.equal(verified.ok && verified.finalStateHash, hashGameState(h2.finalState));
  const mismatched = verifyReplay(v1.initialState, h2Replay, { executeCommand: v1.execute });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.ok === false && mismatched.code, "REPLAY_METADATA_MISMATCH");
});

test("P4-03 H2 is absent from the public web build", () => {
  const generatedCandidate = new URL(
    "../../web/generated/packages/content/src/balance/p4-03-h2.js",
    import.meta.url,
  );
  assert.equal(existsSync(generatedCandidate), false);
  const generatedIndex = new URL("../../web/generated/packages/content/src/index.js", import.meta.url);
  if (existsSync(generatedIndex)) {
    assert.doesNotMatch(readFileSync(generatedIndex, "utf8"), /candidate\.p4-03\.h2/);
  }
});

test("P4-03 H2 keeps deterministic setup and passes the automatic gate", () => {
  const v1 = runAlpha12Simulation(options);
  const v1Repeat = runAlpha12Simulation(options);
  const h2 = runP403H2Simulation(options);
  const h2Repeat = runP403H2Simulation(options);

  assert.deepEqual(v1, v1Repeat);
  assert.deepEqual(h2, h2Repeat);
  assert.equal(v1.metrics.matchCount, 1024);
  assert.equal(h2.metrics.matchCount, 1024);
  assert.equal(v1.metrics.endKindCounts.NORMAL, 1024);
  assert.equal(h2.metrics.endKindCounts.NORMAL, 1024);
  assert.equal(v1.metrics.endKindCounts.INVALID_MATCH, 0);
  assert.equal(h2.metrics.endKindCounts.INVALID_MATCH, 0);
  assert.equal(v1.metrics.endKindCounts.SERVER_ABORT, 0);
  assert.equal(h2.metrics.endKindCounts.SERVER_ABORT, 0);

  assert.equal(v1.metrics.thresholdReachedCounts[75], 152);
  assert.equal(h2.metrics.thresholdReachedCounts[75], 224);
  assert.ok(h2.metrics.thresholdReachedRates[75] - v1.metrics.thresholdReachedRates[75] >= 0.05);
  assert.ok(h2.metrics.maxRoundsRate <= 0.15);
  assert.ok(h2.metrics.firstPlayerDivineSelectionRate >= 0.45);
  assert.ok(h2.metrics.firstPlayerDivineSelectionRate <= 0.55);
  assert.equal(v1.metrics.maxRoundsCount, 71);
  assert.equal(h2.metrics.maxRoundsCount, 93);
  assert.equal(v1.metrics.totalRounds, 5572);
  assert.equal(h2.metrics.totalRounds, 5685);
  assert.deepEqual(v1.metrics, baselineSnapshot.metrics);
  assert.deepEqual(snapshotMatchFacts(v1), {
    finalStateHashes: baselineSnapshot.matches.finalStateHashes,
    endKinds: baselineSnapshot.matches.endKinds,
    firstPlayerIds: baselineSnapshot.matches.firstPlayerIds,
    rounds: baselineSnapshot.matches.rounds,
    thresholdRounds: baselineSnapshot.matches.thresholdRounds,
    maxRoundsReached: baselineSnapshot.matches.maxRoundsReached,
  });
  assert.deepEqual(h2.metrics, candidateSnapshot.metrics);
  assert.deepEqual(snapshotMatchFacts(h2), {
    finalStateHashes: candidateSnapshot.matches.finalStateHashes,
    endKinds: candidateSnapshot.matches.endKinds,
    firstPlayerIds: candidateSnapshot.matches.firstPlayerIds,
    rounds: candidateSnapshot.matches.rounds,
    thresholdRounds: candidateSnapshot.matches.thresholdRounds,
    maxRoundsReached: candidateSnapshot.matches.maxRoundsReached,
  });

  for (const seed of seeds) {
    const v1Setup = createAlpha12Setup({ matchId: "p4-03-h2-v1", seed });
    const h2Setup = createAlpha12Setup({
      matchId: "p4-03-h2-candidate",
      seed,
      catalog: P4_03_H2_CATALOG,
      ruleset: P4_03_H2_PROFILE.ruleset,
      catalogHash: P4_03_H2_PROFILE.catalogHash,
      engineVersion: P4_03_H2_PROFILE.engineVersion,
    });
    assert.deepEqual(h2Setup.shuffledDeck, v1Setup.shuffledDeck, `deck differs for seed ${seed}`);
    assert.deepEqual(h2Setup.hands, v1Setup.hands, `hands differ for seed ${seed}`);
    assert.equal(h2Setup.firstPlayerId, v1Setup.firstPlayerId, `first player differs for seed ${seed}`);
  }
});
