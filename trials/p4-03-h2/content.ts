import {
  P4_03_H2_CATALOG,
  P4_03_H2_CANDIDATE_ID,
  P4_03_H2_PROFILE,
} from "../../packages/content/src/balance/p4-03-h2.ts";
import {
  createAlpha12Setup as createAlpha12SetupBase,
  type Alpha12SetupInput,
  type Alpha12SetupResult,
} from "../../packages/content/src/setup/alpha-12.ts";
import {
  executeAlpha12Command as executeAlpha12CommandBase,
} from "../../packages/content/src/setup/alpha-12-command-executor.ts";
import {
  previewCommand,
  type Command,
  type GameState,
  type PreviewCommandIntent,
  type PreviewResult,
  type ReplayCommandExecution,
  type StateViewer,
} from "../../packages/game-core/src/index.ts";
import type { InitialCardDefinition } from "../../packages/content/src/cards/initial-12.ts";

export const INITIAL_12_CARD_BY_ID = P4_03_H2_CATALOG.byId;
export const H2_TRIAL_CANDIDATE_ID = P4_03_H2_CANDIDATE_ID as string;
export const H2_TRIAL_SOURCE_SHA = "__TRIAL_SOURCE_SHA__";

export function createAlpha12Setup(input: Alpha12SetupInput): Alpha12SetupResult {
  return createAlpha12SetupBase({
    ...input,
    catalog: P4_03_H2_PROFILE.catalog,
    ruleset: P4_03_H2_PROFILE.ruleset,
    catalogHash: P4_03_H2_PROFILE.catalogHash,
    engineVersion: P4_03_H2_PROFILE.engineVersion,
  });
}

export function executeAlpha12Command(state: GameState, command: Command): ReplayCommandExecution {
  return executeAlpha12CommandBase(
    state,
    command,
    P4_03_H2_PROFILE.validationOptions,
    P4_03_H2_PROFILE.catalog,
  );
}

export function previewAlpha12Command(
  state: GameState,
  viewer: StateViewer,
  intent: PreviewCommandIntent,
): PreviewResult {
  return previewCommand(
    state,
    viewer,
    intent,
    executeAlpha12Command,
    (pendingState) => {
      const playerId = pendingState.respondingPlayerId;
      if (!playerId) throw new Error("pending attack response player is required");
      return executeAlpha12Command(pendingState, {
        commandId: `preview.no-response.${pendingState.revision}.${pendingState.turnSequence}.${playerId}`,
        playerId,
        expectedRevision: pendingState.revision,
        commandType: "ACCEPT_DAMAGE",
        payload: {},
      });
    },
  );
}

export type { InitialCardDefinition };
