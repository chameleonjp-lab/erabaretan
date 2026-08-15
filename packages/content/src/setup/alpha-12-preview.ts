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
  return previewCommand(state, viewer, intent, executeAlpha12Command);
}
