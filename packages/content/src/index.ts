export {
  INITIAL_12_CARD_BY_ID,
  INITIAL_12_CARD_DEFINITIONS,
  buildInitial12CardEffects,
  initial12CommandValidationOptions,
  validateInitial12CardPlay,
} from "./cards/initial-12.ts";

export type {
  BuildCardEffectsInput,
  Initial12CardConditionCode,
  Initial12CardConditionResult,
  InitialCardCondition,
  InitialCardDefinition,
  ValidateInitial12CardPlayInput,
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
