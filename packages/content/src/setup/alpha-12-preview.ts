import {
  previewCommand,
  type PreviewCommandIntent,
  type PreviewResult,
  type StateViewer,
} from "../../../game-core/src/index.ts";
import type { GameState } from "../../../game-core/src/state/types.ts";
import { executeAlpha12Command } from "./alpha-12-command-executor.ts";

export function previewAlpha12Command(
  state: GameState,
  viewer: StateViewer,
  intent: PreviewCommandIntent,
): PreviewResult {
  return previewCommand(state, viewer, intent, executeAlpha12Command, (pendingState) => {
    const playerId = pendingState.respondingPlayerId;
    if (!playerId) throw new Error("pending attack response player is required");
    return executeAlpha12Command(pendingState, {
      commandId: `preview.no-response.${pendingState.revision}.${pendingState.turnSequence}.${playerId}`,
      playerId,
      expectedRevision: pendingState.revision,
      commandType: "ACCEPT_DAMAGE",
      payload: {},
    });
  });
}
