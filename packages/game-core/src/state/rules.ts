import type { RulesetSnapshot } from "./types.ts";

export const ALPHA_12_RULESET: RulesetSnapshot = {
  rulesetId: "ruleset.alpha-12.v1",
  worldLawId: "world-law.primordial-fracture.v1",
  playerCount: 2,
  startingHp: 30,
  maxHp: 30,
  startingWorldDurability: 100,
  worldMaxDurability: 100,
  worldThresholds: [75, 50, 25],
  maxRounds: 10,
  startingHand: 7,
  handLimit: 9,
  maxEffectsPerResolution: 32,
  survivalRoundScore: 2,
  survivalBonus: 40,
  worldDamageScoreMultiplier: -3,
  worldRestoreScoreMultiplier: 2,
  worldCollapsePenalty: 25,
};
