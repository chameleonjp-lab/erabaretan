import { ALPHA_12_RULESET } from "../../../game-core/src/state/rules.ts";
import {
  ALPHA_12_CPU_POLICY_ID,
  runAlpha12SimulationWithProfile,
  type Alpha12SimulationOptions,
  type Alpha12SimulationProfile,
  type Alpha12SimulationResult,
} from "../simulation/alpha-12-simulation.ts";
import {
  INITIAL_12_CARD_DEFINITIONS,
  createInitial12Catalog,
  createInitial12CommandValidationOptions,
  type Initial12Catalog,
  type InitialCardDefinition,
} from "../cards/initial-12.ts";
import {
  ALPHA_12_ENGINE_VERSION,
  ALPHA_12_CATALOG_HASH,
} from "../setup/alpha-12.ts";

/** Experimental P4-03 identity. This is not a published alpha-12 V2. */
export const P4_03_H2_CANDIDATE_ID = "candidate.p4-03.h2" as const;
export const P4_03_H2_CARD_ID = "attack.star-breaker.v1" as const;
export const P4_03_H2_WORLD_DAMAGE_FROM = 7 as const;
export const P4_03_H2_WORLD_DAMAGE_TO = 8 as const;

function buildP403H2Definitions(): readonly InitialCardDefinition[] {
  return INITIAL_12_CARD_DEFINITIONS.map((definition) => {
    if (definition.cardDefinitionId !== P4_03_H2_CARD_ID) return definition;
    const release = definition.modes.RELEASE;
    if (!release || release.length !== 2) throw new Error("P4-03 H2 requires the unchanged star-breaker release pair");
    const worldDamage = release[1];
    if (
      worldDamage.commandType !== "DAMAGE_WORLD"
      || worldDamage.payload.amount !== P4_03_H2_WORLD_DAMAGE_FROM
    ) {
      throw new Error("P4-03 H2 source card does not match the expected V1 world damage");
    }
    return {
      ...definition,
      modes: {
        ...definition.modes,
        RELEASE: [
          release[0],
          { ...worldDamage, payload: { ...worldDamage.payload, amount: P4_03_H2_WORLD_DAMAGE_TO } },
        ],
      },
    };
  });
}

export const P4_03_H2_CATALOG: Initial12Catalog = createInitial12Catalog(buildP403H2Definitions());
export const P4_03_H2_RULESET = {
  ...ALPHA_12_RULESET,
  rulesetId: P4_03_H2_CANDIDATE_ID,
};

export const P4_03_H2_PROFILE: Alpha12SimulationProfile = {
  catalog: P4_03_H2_CATALOG,
  ruleset: P4_03_H2_RULESET,
  catalogHash: `${ALPHA_12_CATALOG_HASH}.${P4_03_H2_CANDIDATE_ID}`,
  engineVersion: `${ALPHA_12_ENGINE_VERSION}.${P4_03_H2_CANDIDATE_ID}`,
  simulationVersion: "simulation-metrics.alpha-12.p4-03-h2",
  cpuPolicyId: ALPHA_12_CPU_POLICY_ID,
  validationOptions: createInitial12CommandValidationOptions(P4_03_H2_CATALOG),
};

/** Runs the H2 candidate with the same CPU policy and simulation mechanics as V1. */
export function runP403H2Simulation(options: Alpha12SimulationOptions): Alpha12SimulationResult {
  return runAlpha12SimulationWithProfile(options, P4_03_H2_PROFILE);
}
