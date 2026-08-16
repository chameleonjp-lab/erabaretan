import { previewCommand, } from "../../../game-core/src/index.js";
import { executeAlpha12Command } from "./alpha-12-command-executor.js";
export function previewAlpha12Command(state, viewer, intent) {
    return previewCommand(state, viewer, intent, executeAlpha12Command);
}
