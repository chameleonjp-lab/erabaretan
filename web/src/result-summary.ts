import type { MatchSummary, PlayerId } from "../../packages/game-core/src/index.ts";

type Scalar = number | string | boolean | null;

/** The small event shape shared by core events and effect events. */
export interface ResultEvent {
  readonly type: string;
  readonly details?: Readonly<Record<string, Scalar>>;
}

export type PublicFactType =
  | "WORLD_DAMAGED"
  | "WORLD_RESTORED"
  | "WORLD_THRESHOLD_CROSSED"
  | "PLAYER_DAMAGED"
  | "HP_PAID"
  | "PLAYER_DEFEATED"
  | "WORLD_COLLAPSED"
  | "MATCH_FINISHED";

export interface PublicFact {
  readonly type: PublicFactType;
  readonly playerId?: PlayerId;
  readonly amount?: number;
  readonly thresholds?: readonly number[];
}

/** One accepted command's public facts. Raw command/effect data is never retained here. */
export interface PublicFactBatch {
  readonly facts: readonly PublicFact[];
}

export type TurningPointKind =
  | "WORLD_DAMAGE"
  | "WORLD_RESTORE"
  | "WORLD_THRESHOLD"
  | "PLAYER_DEFEATED"
  | "WORLD_COLLAPSED"
  | "MAX_ROUNDS_REACHED"
  | "SURRENDER";

export interface ResultTurningPoint {
  readonly kind: TurningPointKind;
  readonly batchIndex: number;
  readonly playerIds: readonly PlayerId[];
  readonly amount: number | null;
  readonly thresholds: readonly number[];
}

export interface ResultJudgmentModel {
  readonly turningPoints: readonly ResultTurningPoint[];
  readonly selection: {
    readonly status: MatchSummary["divineSelection"]["status"];
    readonly winnerId: PlayerId | null;
    readonly scores: readonly { readonly playerId: PlayerId; readonly score: number | null }[];
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detailsOf(event: ResultEvent): Readonly<Record<string, Scalar>> {
  return event.details && isRecord(event.details) ? event.details as Readonly<Record<string, Scalar>> : {};
}

function playerIdOf(value: unknown, playerIds: readonly PlayerId[]): PlayerId | undefined {
  return typeof value === "string" && playerIds.includes(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function thresholdOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Converts executor events into a public, result-only fact batch.
 * Card identities, effect IDs, draw details, command history, and secret data are ignored.
 */
export function collectPublicFactBatch(
  events: readonly ResultEvent[],
  playerIds: readonly PlayerId[],
): PublicFactBatch {
  const facts: PublicFact[] = [];
  for (const event of events) {
    const details = detailsOf(event);
    const playerId = playerIdOf(details.playerId ?? details.ownerPlayerId, playerIds);
    if (event.type === "DAMAGE_WORLD_APPLIED") {
      const amount = positiveInteger(details.effective);
      if (playerId && amount) facts.push({ type: "WORLD_DAMAGED", playerId, amount });
      continue;
    }
    if (event.type === "RESTORE_WORLD_APPLIED") {
      const amount = positiveInteger(details.effective);
      if (playerId && amount) facts.push({ type: "WORLD_RESTORED", playerId, amount });
      continue;
    }
    if (event.type === "WORLD_THRESHOLD_TRIGGERED") {
      const threshold = thresholdOf(details.threshold);
      if (threshold) facts.push({ type: "WORLD_THRESHOLD_CROSSED", thresholds: [threshold] });
      continue;
    }
    if (event.type === "DAMAGE_PLAYER_APPLIED") {
      const amount = positiveInteger(details.amount);
      if (playerId && amount) facts.push({ type: "PLAYER_DAMAGED", playerId, amount });
      continue;
    }
    if (event.type === "PAY_HP_APPLIED") {
      const amount = positiveInteger(details.amount);
      if (playerId && amount) facts.push({ type: "HP_PAID", playerId, amount });
      continue;
    }
    if (event.type === "PLAYER_DEFEATED") {
      if (playerId) facts.push({ type: "PLAYER_DEFEATED", playerId });
      continue;
    }
    if (event.type === "WORLD_COLLAPSED") {
      facts.push({ type: "WORLD_COLLAPSED" });
      continue;
    }
    if (event.type === "MATCH_FINISHED") facts.push({ type: "MATCH_FINISHED" });
  }
  return { facts };
}

interface Candidate extends ResultTurningPoint {
  readonly rank: number;
}

function uniquePlayerIds(playerIds: readonly (PlayerId | undefined)[]): PlayerId[] {
  return [...new Set(playerIds.filter((playerId): playerId is PlayerId => Boolean(playerId)))];
}

function aggregateAmount(facts: readonly PublicFact[], type: PublicFactType): number {
  return facts
    .filter((fact) => fact.type === type)
    .reduce((total, fact) => total + (fact.amount ?? 0), 0);
}

function aggregatePlayers(facts: readonly PublicFact[], type: PublicFactType): PlayerId[] {
  return uniquePlayerIds(facts.filter((fact) => fact.type === type).map((fact) => fact.playerId));
}

function aggregateThresholds(facts: readonly PublicFact[]): number[] {
  return [...new Set(facts.flatMap((fact) => fact.type === "WORLD_THRESHOLD_CROSSED" ? fact.thresholds ?? [] : []))]
    .sort((left, right) => right - left);
}

function terminalCandidate(
  batch: PublicFactBatch,
  batchIndex: number,
): Candidate | null {
  const collapsed = batch.facts.some((fact) => fact.type === "WORLD_COLLAPSED");
  const defeated = aggregatePlayers(batch.facts, "PLAYER_DEFEATED");
  if (collapsed) {
    const damage = aggregateAmount(batch.facts, "WORLD_DAMAGED");
    const damageOwner = batch.facts.find((fact) => fact.type === "WORLD_DAMAGED")?.playerId;
    return {
      kind: "WORLD_COLLAPSED",
      batchIndex,
      playerIds: uniquePlayerIds([damageOwner, ...defeated]),
      amount: damage || null,
      thresholds: aggregateThresholds(batch.facts),
      rank: 0,
    };
  }
  if (defeated.length > 0) {
    return {
      kind: "PLAYER_DEFEATED",
      batchIndex,
      playerIds: defeated,
      amount: null,
      thresholds: aggregateThresholds(batch.facts),
      rank: 0,
    };
  }
  return null;
}

function candidateForLargest(
  batches: readonly PublicFactBatch[],
  type: "WORLD_DAMAGED" | "WORLD_RESTORED",
  excludedBatchIndexes: ReadonlySet<number>,
): Candidate | null {
  let best: Candidate | null = null;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    if (excludedBatchIndexes.has(batchIndex)) continue;
    const batch = batches[batchIndex];
    const amount = aggregateAmount(batch.facts, type);
    if (amount <= 0 || (best && amount <= (best.amount ?? 0))) continue;
    const kind: TurningPointKind = type === "WORLD_DAMAGED" ? "WORLD_DAMAGE" : "WORLD_RESTORE";
    best = {
      kind,
      batchIndex,
      playerIds: aggregatePlayers(batch.facts, type),
      amount,
      thresholds: aggregateThresholds(batch.facts),
      rank: type === "WORLD_DAMAGED" ? 1 : 2,
    };
  }
  return best;
}

/** Builds result-only judgment context without changing the authoritative match summary. */
export function composeResultJudgment(
  summary: MatchSummary,
  batches: readonly PublicFactBatch[],
): ResultJudgmentModel {
  const candidates: Candidate[] = [];
  const excludedBatchIndexes = new Set<number>();

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const rawCandidate = terminalCandidate(batches[batchIndex], batchIndex);
    const candidate = rawCandidate?.kind === "WORLD_COLLAPSED" && summary.world.collapseResponsiblePlayerId
      ? { ...rawCandidate, playerIds: uniquePlayerIds([...rawCandidate.playerIds, summary.world.collapseResponsiblePlayerId]) }
      : rawCandidate;
    if (!candidate) continue;
    candidates.push(candidate);
    excludedBatchIndexes.add(batchIndex);
  }

  const largestDamage = candidateForLargest(batches, "WORLD_DAMAGED", excludedBatchIndexes);
  if (largestDamage) {
    candidates.push(largestDamage);
    excludedBatchIndexes.add(largestDamage.batchIndex);
  }
  const largestRestore = candidateForLargest(batches, "WORLD_RESTORED", excludedBatchIndexes);
  if (largestRestore) {
    candidates.push(largestRestore);
    excludedBatchIndexes.add(largestRestore.batchIndex);
  }

  const thresholdBatch = batches.findIndex((batch, batchIndex) => !excludedBatchIndexes.has(batchIndex) && batch.facts.some((fact) => fact.type === "WORLD_THRESHOLD_CROSSED"));
  if (thresholdBatch >= 0 && !excludedBatchIndexes.has(thresholdBatch)) {
    candidates.push({
      kind: "WORLD_THRESHOLD",
      batchIndex: thresholdBatch,
      playerIds: [],
      amount: null,
      thresholds: aggregateThresholds(batches[thresholdBatch].facts),
      rank: 3,
    });
  }

  const hasWorldCollapsePoint = candidates.some((candidate) => candidate.kind === "WORLD_COLLAPSED");
  const hasDefeatPoint = candidates.some((candidate) => (
    candidate.kind === "PLAYER_DEFEATED"
    || (candidate.kind === "WORLD_COLLAPSED" && batches[candidate.batchIndex]?.facts.some((fact) => fact.type === "PLAYER_DEFEATED"))
  ));
  if (summary.normalEndReasons.includes("WORLD_COLLAPSED") && !hasWorldCollapsePoint) {
    candidates.push({
      kind: "WORLD_COLLAPSED",
      batchIndex: batches.length,
      playerIds: summary.world.collapseResponsiblePlayerId ? [summary.world.collapseResponsiblePlayerId] : [],
      amount: null,
      thresholds: [],
      rank: 0,
    });
  }
  if (summary.normalEndReasons.includes("PLAYER_DEFEATED") && !hasDefeatPoint) {
    const defeated = summary.battle.winnerId
      ? summary.players.filter((player) => player.playerId !== summary.battle.winnerId).map((player) => player.playerId)
      : [];
    candidates.push({ kind: "PLAYER_DEFEATED", batchIndex: batches.length, playerIds: defeated, amount: null, thresholds: [], rank: 0 });
  }
  if (summary.endKind === "SURRENDER") {
    const surrendering = summary.battle.winnerId
      ? summary.players.find((player) => player.playerId !== summary.battle.winnerId)?.playerId
      : undefined;
    candidates.push({ kind: "SURRENDER", batchIndex: batches.length, playerIds: surrendering ? [surrendering] : [], amount: null, thresholds: [], rank: 4 });
  } else if (summary.normalEndReasons.includes("MAX_ROUNDS_REACHED")) {
    candidates.push({ kind: "MAX_ROUNDS_REACHED", batchIndex: batches.length, playerIds: [], amount: null, thresholds: [], rank: 4 });
  }

  const turningPoints = candidates
    .sort((left, right) => left.rank - right.rank || left.batchIndex - right.batchIndex)
    .slice(0, 3)
    .sort((left, right) => left.batchIndex - right.batchIndex || left.rank - right.rank)
    .map(({ rank: _rank, ...point }) => point);

  return {
    turningPoints,
    selection: {
      status: summary.divineSelection.status,
      winnerId: summary.divineSelection.winnerId,
      scores: summary.players.map((player) => ({ playerId: player.playerId, score: player.score })),
    },
  };
}
