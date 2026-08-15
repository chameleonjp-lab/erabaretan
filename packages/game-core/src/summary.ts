import { calculateJudgmentBreakdown } from "./judgment/calculate.ts";
import { assertGameState } from "./state/invariants.ts";
import type { GameState, PlayerId } from "./state/types.ts";

export const MATCH_SUMMARY_VERSION = "match-summary.alpha-12.v1" as const;

export type NormalEndReason = "PLAYER_DEFEATED" | "WORLD_COLLAPSED" | "MAX_ROUNDS_REACHED";

export interface MatchPlayerSummary {
  readonly playerId: PlayerId;
  readonly score: number | null;
  readonly survivalEvaluation: number | null;
  readonly worldEvaluation: number | null;
  readonly worldDamageResponsibility: number;
  readonly effectiveWorldRestore: number;
  readonly causedWorldCollapse: boolean;
}

export interface MatchBattleSummary {
  readonly status: "WINNER" | "DRAW" | "VOID";
  readonly winnerId: PlayerId | null;
}

export interface MatchDivineSelectionSummary {
  readonly status: "SELECTED" | "TIE" | "NOT_AWARDED";
  readonly winnerId: PlayerId | null;
}

export interface MatchSummary {
  readonly summaryVersion: typeof MATCH_SUMMARY_VERSION;
  readonly matchId: string;
  readonly endKind: NonNullable<GameState["terminalFlags"]["endKind"]>;
  readonly normalEndReasons: readonly NormalEndReason[];
  readonly battle: MatchBattleSummary;
  readonly divineSelection: MatchDivineSelectionSummary;
  readonly scoreStatus: "FINAL" | "NOT_AWARDED";
  readonly players: readonly MatchPlayerSummary[];
  readonly world: {
    readonly durability: number;
    readonly maxDurability: number;
    readonly collapsed: boolean;
    readonly collapseResponsiblePlayerId: PlayerId | null;
  };
}

export type MatchSummaryErrorCode =
  | "MATCH_NOT_FINISHED"
  | "TERMINAL_STATE_INCONSISTENT"
  | "JUDGMENT_MISSING"
  | "JUDGMENT_MISMATCH";

export type MatchSummaryResult =
  | { readonly ok: true; readonly summary: MatchSummary }
  | { readonly ok: false; readonly code: MatchSummaryErrorCode };

function normalEndReasons(state: GameState): readonly NormalEndReason[] {
  const reasons: NormalEndReason[] = [];
  if (state.terminalFlags.defeatedPlayerIds.length > 0) reasons.push("PLAYER_DEFEATED");
  if (state.terminalFlags.worldCollapsed) reasons.push("WORLD_COLLAPSED");
  if (state.terminalFlags.maxRoundsReached) reasons.push("MAX_ROUNDS_REACHED");
  return reasons;
}

function judgmentMatches(state: GameState): boolean {
  if (!state.judgment) return false;
  const calculated = calculateJudgmentBreakdown(state).judgment;
  const expectedIds = state.initialPlayerOrder;
  const savedIds = Object.keys(state.judgment.playerScores);
  if (savedIds.length !== expectedIds.length || savedIds.some((playerId) => !expectedIds.includes(playerId))) return false;
  if (calculated.winnerId !== state.judgment.winnerId) return false;
  if (state.terminalFlags.divineSelectionWinnerId !== state.judgment.winnerId) return false;
  return expectedIds.every((playerId) => calculated.playerScores[playerId] === state.judgment?.playerScores[playerId]);
}

function playerSummaries(
  state: GameState,
  breakdown: Readonly<Record<PlayerId, { readonly survivalEvaluation: number; readonly worldEvaluation: number }>> | null,
): readonly MatchPlayerSummary[] {
  return state.initialPlayerOrder.map((playerId) => {
    const player = state.players[playerId];
    const detail = breakdown?.[playerId];
    return {
      playerId,
      score: breakdown && state.judgment ? state.judgment.playerScores[playerId] ?? null : null,
      survivalEvaluation: detail?.survivalEvaluation ?? null,
      worldEvaluation: detail?.worldEvaluation ?? null,
      worldDamageResponsibility: player.worldDamageResponsibility,
      effectiveWorldRestore: player.effectiveWorldRestore,
      causedWorldCollapse: state.world.collapseResponsiblePlayerId === playerId,
    };
  });
}

function summaryFor(state: GameState, breakdown: ReturnType<typeof calculateJudgmentBreakdown>["breakdown"] | null): MatchSummary {
  const endKind = state.terminalFlags.endKind as NonNullable<GameState["terminalFlags"]["endKind"]>;
  const reasons = endKind === "NORMAL" ? normalEndReasons(state) : [];
  const isVoid = endKind === "SERVER_ABORT" || endKind === "INVALID_MATCH";
  const battle: MatchBattleSummary = isVoid
    ? { status: "VOID", winnerId: null }
    : state.terminalFlags.battleWinnerId
      ? { status: "WINNER", winnerId: state.terminalFlags.battleWinnerId }
      : { status: "DRAW", winnerId: null };
  const divineSelection: MatchDivineSelectionSummary = endKind !== "NORMAL"
    ? { status: "NOT_AWARDED", winnerId: null }
    : state.terminalFlags.divineSelectionWinnerId
      ? { status: "SELECTED", winnerId: state.terminalFlags.divineSelectionWinnerId }
      : { status: "TIE", winnerId: null };
  return {
    summaryVersion: MATCH_SUMMARY_VERSION,
    matchId: state.matchId,
    endKind,
    normalEndReasons: reasons,
    battle,
    divineSelection,
    scoreStatus: endKind === "NORMAL" ? "FINAL" : "NOT_AWARDED",
    players: playerSummaries(state, breakdown),
    world: {
      durability: state.world.durability,
      maxDurability: state.world.maxDurability,
      collapsed: state.terminalFlags.worldCollapsed,
      collapseResponsiblePlayerId: state.world.collapseResponsiblePlayerId,
    },
  };
}

/** Builds a safe final-result summary from authoritative terminal state only. */
export function summarizeMatch(state: GameState): MatchSummaryResult {
  if (state.phase !== "FINISHED") return { ok: false, code: "MATCH_NOT_FINISHED" };
  try {
    assertGameState(state);
  } catch {
    return { ok: false, code: "TERMINAL_STATE_INCONSISTENT" };
  }
  const endKind = state.terminalFlags.endKind;
  if (endKind === null) return { ok: false, code: "TERMINAL_STATE_INCONSISTENT" };
  if (endKind === "NORMAL") {
    if (normalEndReasons(state).length === 0) return { ok: false, code: "TERMINAL_STATE_INCONSISTENT" };
    if (!state.judgment) return { ok: false, code: "JUDGMENT_MISSING" };
    try {
      if (!judgmentMatches(state)) return { ok: false, code: "JUDGMENT_MISMATCH" };
      const { breakdown } = calculateJudgmentBreakdown(state);
      return { ok: true, summary: summaryFor(state, breakdown) };
    } catch {
      return { ok: false, code: "JUDGMENT_MISMATCH" };
    }
  }
  return { ok: true, summary: summaryFor(state, null) };
}

export const createMatchSummary = summarizeMatch;
