export {
  INITIAL_12_CARD_BY_ID,
  INITIAL_12_CARD_DEFINITIONS,
  buildInitial12CardEffects,
  initial12CommandValidationOptions,
  validateInitial12CardPlay,
  validateInitial12CardPlayFromPublicState,
} from "./cards/initial-12.ts";

export type {
  BuildCardEffectsInput,
  Initial12CardConditionCode,
  Initial12CardConditionResult,
  InitialCardCondition,
  InitialCardDefinition,
  ValidateInitial12CardPlayInput,
  ValidateInitial12CardPublicPlayInput,
} from "./cards/initial-12.ts";

export {
  ALPHA_12_CATALOG_HASH,
  ALPHA_12_ENGINE_VERSION,
  buildInitial12Deck,
  createAlpha12InitialGameState,
  createAlpha12Setup,
  sortInitial12Definitions,
} from "./setup/alpha-12.ts";

export type { Alpha12SetupInput, Alpha12SetupResult } from "./setup/alpha-12.ts";

export { executeAlpha12Command } from "./setup/alpha-12-command-executor.ts";
export { previewAlpha12Command } from "./setup/alpha-12-preview.ts";

export {
  alpha12CpuCommandId,
  enumerateAlpha12CpuActions,
  generateAlpha12CpuLegalCommands,
  materializeAlpha12CpuCommand,
} from "./cpu/legal-actions.ts";

export type { CpuActionIntent } from "./cpu/legal-actions.ts";

export {
  ALPHA_12_CPU_POLICY_ID,
  ALPHA_12_SIMULATION_VERSION,
  DEFAULT_MAX_SIMULATION_STEPS,
  runAlpha12Simulation,
} from "./simulation/alpha-12-simulation.ts";

export type {
  Alpha12CardUsage,
  Alpha12SimulationMatchRecord,
  Alpha12SimulationMetrics,
  Alpha12SimulationOptions,
  Alpha12SimulationResult,
  Alpha12ThresholdRounds,
  SimulationRate,
  SimulationEndKind,
  SimulationThreshold,
} from "./simulation/alpha-12-simulation.ts";
