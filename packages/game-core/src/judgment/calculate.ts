import type { GameState, JudgmentState, PlayerId } from "../state/types.ts";

export interface JudgmentBreakdown {
  readonly survivalEvaluation: number;
  readonly worldEvaluation: number;
  readonly divineEvaluation: number;
}

export interface JudgmentResult {
  readonly judgment: JudgmentState;
  readonly breakdown: Readonly<Record<PlayerId, JudgmentBreakdown>>;
}

function sumModifier(state: GameState, playerId: PlayerId, modifierKind: string): number {
  return state.scoreModifiers
    .filter((modifier) => modifier.playerId === playerId && modifier.modifierKind === modifierKind)
    .reduce((total, modifier) => total + modifier.amount, 0);
}

function winnerForScores(scores: Readonly<Record<PlayerId, number>>, playerIds: readonly PlayerId[]): PlayerId | null {
  const highest = Math.max(...playerIds.map((playerId) => scores[playerId]));
  const winners = playerIds.filter((playerId) => scores[playerId] === highest);
  return winners.length === 1 ? winners[0] : null;
}

/**
 * Calculates the normal-game divine evaluation from the authoritative state.
 * Non-normal endings are intentionally represented by a null winner by the
 * terminal resolver rather than being treated as a normal score.
 */
export function calculateJudgment(state: GameState): JudgmentState {
  const playerIds = state.initialPlayerOrder;
  const scores: Record<PlayerId, number> = {};

  for (const playerId of playerIds) {
    const player = state.players[playerId];
    const survived = player.hitPoints > 0;
    const survivalEvaluation = player.survivedRoundCount * state.ruleset.survivalRoundScore
      + player.hitPoints
      + (survived ? state.ruleset.survivalBonus : 0)
      + sumModifier(state, playerId, "SURVIVAL_BONUS");

    const explicitCollapsePenalty = sumModifier(state, playerId, "WORLD_COLLAPSE_PENALTY");
    const fallbackCollapsePenalty = state.terminalFlags.worldCollapsed
      && state.world.collapseResponsiblePlayerId === playerId
      && explicitCollapsePenalty === 0
      ? state.ruleset.worldCollapsePenalty
      : 0;
    const collapsePenalty = explicitCollapsePenalty + fallbackCollapsePenalty;
    const worldEvaluation = (player.effectiveWorldRestore + sumModifier(state, playerId, "EFFECTIVE_WORLD_RESTORE"))
      * state.ruleset.worldRestoreScoreMultiplier
      + (player.worldDamageResponsibility + sumModifier(state, playerId, "WORLD_DAMAGE_RESPONSIBILITY"))
      * state.ruleset.worldDamageScoreMultiplier
      - collapsePenalty;

    scores[playerId] = survivalEvaluation + worldEvaluation;
  }

  return { playerScores: scores, winnerId: winnerForScores(scores, playerIds) };
}

export function calculateJudgmentBreakdown(state: GameState): JudgmentResult {
  const judgment = calculateJudgment(state);
  const breakdown: Record<PlayerId, JudgmentBreakdown> = {};
  for (const playerId of state.initialPlayerOrder) {
    const player = state.players[playerId];
    const survivalEvaluation = player.survivedRoundCount * state.ruleset.survivalRoundScore
      + player.hitPoints
      + (player.hitPoints > 0 ? state.ruleset.survivalBonus : 0)
      + sumModifier(state, playerId, "SURVIVAL_BONUS");
    const explicitCollapsePenalty = sumModifier(state, playerId, "WORLD_COLLAPSE_PENALTY");
    const fallbackCollapsePenalty = state.terminalFlags.worldCollapsed
      && state.world.collapseResponsiblePlayerId === playerId
      && explicitCollapsePenalty === 0
      ? state.ruleset.worldCollapsePenalty
      : 0;
    const worldEvaluation = (player.effectiveWorldRestore + sumModifier(state, playerId, "EFFECTIVE_WORLD_RESTORE"))
      * state.ruleset.worldRestoreScoreMultiplier
      + (player.worldDamageResponsibility + sumModifier(state, playerId, "WORLD_DAMAGE_RESPONSIBILITY"))
      * state.ruleset.worldDamageScoreMultiplier
      - explicitCollapsePenalty
      - fallbackCollapsePenalty;
    breakdown[playerId] = {
      survivalEvaluation,
      worldEvaluation,
      divineEvaluation: judgment.playerScores[playerId],
    };
  }
  return { judgment, breakdown };
}
