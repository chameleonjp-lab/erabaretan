import { assertGameState } from "./state/invariants.js";
import { hashGameState } from "./hash/state-hash.js";
const COMMAND_TYPES = [
    "PLAY_CARD",
    "DISCARD_FOR_ACTION",
    "DISCARD_OVERFLOW",
    "SELECT_RESPONSE",
    "ACCEPT_DAMAGE",
    "SURRENDER",
    "TIMEOUT_DEFAULT_ACTION",
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(record, keys) {
    const allowed = new Set(keys);
    return Object.keys(record).every((key) => allowed.has(key));
}
function isPreviewIntent(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ["commandType", "playerId", "payload"]))
        return false;
    return typeof value.commandType === "string"
        && COMMAND_TYPES.includes(value.commandType)
        && typeof value.playerId === "string"
        && "payload" in value;
}
function viewerPlayerId(viewer) {
    if (!isRecord(viewer) || viewer.kind !== "PLAYER" || typeof viewer.playerId !== "string")
        return null;
    return viewer.playerId;
}
function rejection(basedOnRevision, code) {
    return { status: "REJECTED", basedOnRevision, code };
}
function unavailable(basedOnRevision, reason) {
    return { status: "UNAVAILABLE", basedOnRevision, reason };
}
function commandCardInstanceIds(intent) {
    if (!isRecord(intent.payload))
        return null;
    const ids = [];
    if (intent.commandType === "PLAY_CARD") {
        if (typeof intent.payload.cardInstanceId !== "string")
            return null;
        ids.push(intent.payload.cardInstanceId);
        if (intent.payload.discardCardInstanceId !== undefined) {
            if (typeof intent.payload.discardCardInstanceId !== "string")
                return null;
            ids.push(intent.payload.discardCardInstanceId);
        }
        return ids;
    }
    if (intent.commandType === "DISCARD_FOR_ACTION" || intent.commandType === "DISCARD_OVERFLOW" || intent.commandType === "SELECT_RESPONSE") {
        if (typeof intent.payload.cardInstanceId !== "string")
            return null;
        return [intent.payload.cardInstanceId];
    }
    return [];
}
function cardIsAvailableToPlayer(state, playerId, cardInstanceId) {
    return Boolean(state.cardInstances[cardInstanceId]) && state.cardZones.hands[playerId]?.includes(cardInstanceId) === true;
}
function publicRejectionCode(code) {
    switch (code) {
        case "NOT_ACTIVE_PLAYER":
        case "NOT_RESPONDING_PLAYER":
            return "NOT_YOUR_TURN";
        case "INVALID_TARGET":
            return "INVALID_TARGET";
        case "CARD_CONDITION_NOT_MET":
            return "CONDITION_NOT_MET";
        case "MATCH_FINISHED":
            return "MATCH_FINISHED";
        case "COMMAND_NOT_ALLOWED_IN_PHASE":
        case "RESOLUTION_IN_PROGRESS":
        case "NO_HAND_OVERFLOW":
            return "COMMAND_NOT_ALLOWED";
        case "CARD_NOT_IN_HAND":
        case "UNKNOWN_CARD_INSTANCE":
            return "CARD_UNAVAILABLE";
        case "MALFORMED_COMMAND":
        case "INVALID_COMMAND_ID":
        case "INVALID_PLAYER_ID":
        case "INVALID_REVISION":
        case "STALE_REVISION":
        case "INVALID_COMMAND_TYPE":
        case "INVALID_PAYLOAD":
        case "COMMAND_ID_REUSE":
        default:
            return "INVALID_INTENT";
    }
}
function internalCommandId(state, commandType) {
    const prefix = `preview.${state.revision}.${state.turnSequence}.${commandType}`;
    let suffix = 1;
    let commandId = `${prefix}.${String(suffix).padStart(4, "0")}`;
    while (state.commandHistory[commandId]) {
        suffix += 1;
        commandId = `${prefix}.${String(suffix).padStart(4, "0")}`;
    }
    return commandId;
}
function buildCommand(state, intent) {
    const base = {
        commandId: internalCommandId(state, intent.commandType),
        playerId: intent.playerId,
        expectedRevision: state.revision,
    };
    switch (intent.commandType) {
        case "PLAY_CARD":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "DISCARD_FOR_ACTION":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "DISCARD_OVERFLOW":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "SELECT_RESPONSE":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "ACCEPT_DAMAGE":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "SURRENDER":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
        case "TIMEOUT_DEFAULT_ACTION":
            return { ...base, commandType: intent.commandType, payload: intent.payload };
    }
}
function snapshotCommandHistory(state) {
    return JSON.stringify(state.commandHistory);
}
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
function createDelta(before, after) {
    const playerHitPointDeltas = {};
    const handCountDeltas = {};
    for (const playerId of before.initialPlayerOrder) {
        const beforePlayer = before.players[playerId];
        const afterPlayer = after.players[playerId];
        if (!beforePlayer || !afterPlayer)
            throw new Error(`missing player in preview result: ${playerId}`);
        playerHitPointDeltas[playerId] = afterPlayer.hitPoints - beforePlayer.hitPoints;
        handCountDeltas[playerId] = after.cardZones.hands[playerId].length - before.cardZones.hands[playerId].length;
    }
    const crossedWorldThresholds = after.world.triggeredThresholds.filter((threshold) => !before.world.triggeredThresholds.includes(threshold));
    return {
        playerHitPointDeltas,
        handCountDeltas,
        worldDurabilityDelta: after.world.durability - before.world.durability,
        crossedWorldThresholds,
        phaseAfter: after.phase,
        wouldFinishMatch: after.phase === "FINISHED",
    };
}
function hasHiddenDraw(before, after, events) {
    return events.some((event) => event.type === "DRAW_CARD")
        || before.cardZones.drawPile.length !== after.cardZones.drawPile.length;
}
/**
 * Executes a preview through the production command executor and exposes only
 * public deltas. The executor receives a generated envelope, never caller data.
 */
export function previewCommand(state, viewer, intent, executor) {
    const basedOnRevision = typeof state?.revision === "number" ? state.revision : -1;
    if (viewer?.kind !== "PLAYER")
        return rejection(basedOnRevision, "VIEWER_NOT_PLAYER");
    const viewerId = viewerPlayerId(viewer);
    if (!viewerId || !state?.players?.[viewerId])
        return rejection(basedOnRevision, "VIEWER_NOT_PLAYER");
    if (!isPreviewIntent(intent))
        return rejection(basedOnRevision, "INVALID_INTENT");
    if (intent.playerId !== viewerId)
        return rejection(basedOnRevision, "PLAYER_MISMATCH");
    if (intent.commandType === "TIMEOUT_DEFAULT_ACTION")
        return rejection(basedOnRevision, "COMMAND_NOT_PREVIEWABLE");
    try {
        assertGameState(state);
    }
    catch {
        return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
    }
    if (state.phase === "FINISHED")
        return rejection(basedOnRevision, "MATCH_FINISHED");
    const cardIds = commandCardInstanceIds(intent);
    if (cardIds === null)
        return rejection(basedOnRevision, "INVALID_INTENT");
    if (cardIds.some((cardInstanceId) => !cardIsAvailableToPlayer(state, viewerId, cardInstanceId))) {
        return rejection(basedOnRevision, "CARD_UNAVAILABLE");
    }
    const beforeHash = hashGameState(state);
    const beforeRevision = state.revision;
    const beforeRandomConsumptionCount = state.randomConsumptionCount;
    const beforeHistory = snapshotCommandHistory(state);
    let execution;
    try {
        execution = executor(cloneState(state), buildCommand(state, intent));
    }
    catch {
        return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
    }
    if (state.revision !== beforeRevision
        || state.randomConsumptionCount !== beforeRandomConsumptionCount
        || snapshotCommandHistory(state) !== beforeHistory
        || hashGameState(state) !== beforeHash) {
        return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
    }
    if (!execution || !execution.state)
        return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
    if (!execution.accepted)
        return rejection(basedOnRevision, publicRejectionCode(execution.error?.code ?? "UNKNOWN"));
    if (execution.replayed)
        return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
    if (execution.state.randomConsumptionCount !== beforeRandomConsumptionCount) {
        return unavailable(basedOnRevision, "RANDOM_DEPENDENT");
    }
    try {
        assertGameState(execution.state);
        const delta = createDelta(state, execution.state);
        const uncertainties = [];
        const isWaitingForOpponentResponse = execution.state.phase === "RESPONSE_SELECTION"
            && execution.state.pendingAttack !== null;
        if (isWaitingForOpponentResponse)
            uncertainties.push("OPPONENT_RESPONSE");
        if (hasHiddenDraw(state, execution.state, execution.events))
            uncertainties.push("HIDDEN_DRAW_IDENTITY");
        const result = {
            status: "READY",
            certainty: uncertainties.length > 0 ? "PARTIAL" : "EXACT",
            basedOnRevision,
            delta,
            uncertainties,
        };
        if (isWaitingForOpponentResponse && execution.state.pendingAttack) {
            return {
                ...result,
                pendingAttackBaseDamage: execution.state.pendingAttack.baseDamage,
            };
        }
        return result;
    }
    catch {
        return unavailable(basedOnRevision, "UNSAFE_SECRET_DEPENDENCY");
    }
}
