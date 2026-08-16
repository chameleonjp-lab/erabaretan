import { previewCommand, } from "../../../game-core/src/index.js";
import { executeAlpha12Command } from "./alpha-12-command-executor.js";
export function previewAlpha12Command(state, viewer, intent) {
    return previewCommand(state, viewer, intent, executeAlpha12Command, (pendingState) => {
        const playerId = pendingState.respondingPlayerId;
        if (!playerId)
            throw new Error("pending attack response player is required");
        return executeAlpha12Command(pendingState, {
            commandId: `preview.no-response.${pendingState.revision}.${pendingState.turnSequence}.${playerId}`,
            playerId,
            expectedRevision: pendingState.revision,
            commandType: "ACCEPT_DAMAGE",
            payload: {},
        });
    });
}
