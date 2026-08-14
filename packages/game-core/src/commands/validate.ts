import type { GameState, PlayMode, PlayerId } from "../state/types.ts";
import type { Command, CommandType, EmptyPayload } from "./types.ts";

export type CommandRejectionCode =
  | "MALFORMED_COMMAND"
  | "INVALID_COMMAND_ID"
  | "INVALID_PLAYER_ID"
  | "INVALID_REVISION"
  | "STALE_REVISION"
  | "INVALID_COMMAND_TYPE"
  | "INVALID_PAYLOAD"
  | "COMMAND_ID_REUSE"
  | "COMMAND_NOT_ALLOWED_IN_PHASE"
  | "NOT_ACTIVE_PLAYER"
  | "NOT_RESPONDING_PLAYER"
  | "NO_HAND_OVERFLOW"
  | "CARD_NOT_IN_HAND"
  | "UNKNOWN_CARD_INSTANCE"
  | "INVALID_TARGET"
  | "CARD_CONDITION_NOT_MET"
  | "MATCH_FINISHED"
  | "RESOLUTION_IN_PROGRESS";

export interface CommandRejection {
  readonly code: CommandRejectionCode;
  readonly message: string;
  readonly commandId: string | null;
}

export interface CommandHistoryReplay {
  readonly kind: "REPLAY";
  readonly command: Command;
  readonly events: readonly unknown[];
}

export type ValidationResult =
  | { readonly ok: true; readonly kind: "NEW"; readonly command: Command }
  | { readonly ok: true; readonly kind: "REPLAY"; readonly replay: CommandHistoryReplay }
  | { readonly ok: false; readonly error: CommandRejection };

export interface CardConditionValidationInput {
  readonly state: GameState;
  readonly playerId: PlayerId;
  readonly cardInstanceId: string;
  readonly mode: PlayMode | "RESPONSE";
  readonly targetPlayerId?: PlayerId | null;
  readonly discardCardInstanceId?: string | null;
}

export interface CommandValidationOptions {
  readonly cardConditionValidator?: (input: CardConditionValidationInput) =>
    | { readonly ok: true }
    | { readonly ok: false; readonly code: "INVALID_TARGET" | "CARD_CONDITION_NOT_MET"; readonly message: string };
}

const COMMAND_TYPES: readonly CommandType[] = [
  "PLAY_CARD",
  "DISCARD_FOR_ACTION",
  "DISCARD_OVERFLOW",
  "SELECT_RESPONSE",
  "ACCEPT_DAMAGE",
  "SURRENDER",
  "TIMEOUT_DEFAULT_ACTION",
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,127}$/;

function rejection(code: CommandRejectionCode, message: string, commandId: string | null = null): ValidationResult {
  return { ok: false, error: { code, message, commandId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isPlayerId(state: GameState, value: unknown): value is PlayerId {
  return typeof value === "string" && Boolean(state.players[value]);
}

function isEmptyPayload(value: unknown): value is EmptyPayload {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isCommandType(value: unknown): value is CommandType {
  return typeof value === "string" && COMMAND_TYPES.includes(value as CommandType);
}

function commandPhaseAllowed(state: GameState, commandType: CommandType, playerId: PlayerId): ValidationResult | null {
  if (state.phase === "FINISHED") return rejection("MATCH_FINISHED", "FINISHED state accepts no commands", null);
  if (state.phase === "RESOLUTION") {
    return rejection("RESOLUTION_IN_PROGRESS", "RESOLUTION does not accept external commands", null);
  }
  if (commandType === "SURRENDER") {
    if (state.phase !== "ACTION_SELECTION" && state.phase !== "RESPONSE_SELECTION") {
      return rejection("COMMAND_NOT_ALLOWED_IN_PHASE", `${commandType} is not allowed in ${state.phase}`, null);
    }
    return null;
  }
  if (state.phase === "ACTION_SELECTION") {
    if (playerId !== state.activePlayerId) return rejection("NOT_ACTIVE_PLAYER", "only active player may act", null);
    if (!["PLAY_CARD", "DISCARD_FOR_ACTION", "TIMEOUT_DEFAULT_ACTION"].includes(commandType)) {
      return rejection("COMMAND_NOT_ALLOWED_IN_PHASE", `${commandType} is not allowed in ACTION_SELECTION`, null);
    }
    return null;
  }
  if (state.phase === "TURN_START") {
    if (playerId !== state.activePlayerId) return rejection("NOT_ACTIVE_PLAYER", "only active player may resolve overflow", null);
    if (commandType !== "DISCARD_OVERFLOW") {
      return rejection("COMMAND_NOT_ALLOWED_IN_PHASE", `${commandType} is not allowed in TURN_START`, null);
    }
    if (state.cardZones.hands[playerId].length <= state.ruleset.handLimit) {
      return rejection("NO_HAND_OVERFLOW", "DISCARD_OVERFLOW is only allowed while hand exceeds the limit", null);
    }
    return null;
  }
  if (state.phase === "RESPONSE_SELECTION") {
    if (playerId !== state.respondingPlayerId) return rejection("NOT_RESPONDING_PLAYER", "only responding player may answer", null);
    if (commandType !== "SELECT_RESPONSE" && commandType !== "ACCEPT_DAMAGE") {
      return rejection("COMMAND_NOT_ALLOWED_IN_PHASE", `${commandType} is not allowed in RESPONSE_SELECTION`, null);
    }
    return null;
  }
  return rejection("COMMAND_NOT_ALLOWED_IN_PHASE", `${commandType} is not allowed in ${state.phase}`, null);
}

export function validateCommand(state: GameState, input: unknown, options: CommandValidationOptions = {}): ValidationResult {
  if (!isRecord(input)) return rejection("MALFORMED_COMMAND", "command must be a JSON object");

  const commandId = typeof input.commandId === "string" ? input.commandId : null;
  if (!isId(input.commandId)) return rejection("INVALID_COMMAND_ID", "commandId must be a stable non-empty identifier", commandId);
  if (!isPlayerId(state, input.playerId)) return rejection("INVALID_PLAYER_ID", "playerId is not in this match", input.commandId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return rejection("INVALID_REVISION", "expectedRevision must be a non-negative safe integer", input.commandId);
  }
  if (!isCommandType(input.commandType)) {
    return rejection("INVALID_COMMAND_TYPE", "commandType is not supported", input.commandId);
  }

  const previous = state.commandHistory[input.commandId];
  if (previous) {
    if (canonicalJson(previous.command) !== canonicalJson(input)) {
      return rejection("COMMAND_ID_REUSE", "commandId was already used with different content", input.commandId);
    }
    return {
      ok: true,
      kind: "REPLAY",
      replay: {
        kind: "REPLAY",
        command: previous.command as Command,
        events: previous.events,
      },
    };
  }

  if (input.expectedRevision !== state.revision) {
    return rejection("STALE_REVISION", `expectedRevision ${input.expectedRevision} does not match ${state.revision}`, input.commandId);
  }
  const phaseError = commandPhaseAllowed(state, input.commandType, input.playerId);
  if (phaseError) return { ...phaseError, error: { ...phaseError.error, commandId: input.commandId } };

  const payload = input.payload;
  if (input.commandType === "PLAY_CARD") {
    if (!isRecord(payload) || !hasOnlyKeys(payload, ["cardInstanceId", "playMode", "targetPlayerId", "discardCardInstanceId"])) {
      return rejection("INVALID_PAYLOAD", "PLAY_CARD payload has unexpected fields", input.commandId);
    }
    if (!isId(payload.cardInstanceId) || (payload.playMode !== "RELEASE" && payload.playMode !== "RESTRAIN")) {
      return rejection("INVALID_PAYLOAD", "PLAY_CARD requires cardInstanceId and playMode", input.commandId);
    }
    if (payload.targetPlayerId !== undefined && !isPlayerId(state, payload.targetPlayerId)) {
      return rejection("INVALID_TARGET", "targetPlayerId is not in this match", input.commandId);
    }
    if (payload.discardCardInstanceId !== undefined && !isId(payload.discardCardInstanceId)) {
      return rejection("INVALID_PAYLOAD", "discardCardInstanceId must be a stable identifier", input.commandId);
    }
    if (!state.cardInstances[payload.cardInstanceId]) {
      return rejection("UNKNOWN_CARD_INSTANCE", "cardInstanceId does not exist", input.commandId);
    }
    if (!state.cardZones.hands[input.playerId].includes(payload.cardInstanceId)) {
      return rejection("CARD_NOT_IN_HAND", "cardInstanceId is not in the player's hand", input.commandId);
    }
    if (options.cardConditionValidator) {
      const condition = options.cardConditionValidator({
        state,
        playerId: input.playerId,
        cardInstanceId: payload.cardInstanceId,
        mode: payload.playMode,
        targetPlayerId: payload.targetPlayerId ?? null,
        discardCardInstanceId: payload.discardCardInstanceId ?? null,
      });
      if (!condition.ok) return rejection(condition.code, condition.message, input.commandId);
    }
    return { ok: true, kind: "NEW", command: { ...input, payload: { ...payload } } as Command };
  }

  if (input.commandType === "DISCARD_FOR_ACTION" || input.commandType === "DISCARD_OVERFLOW") {
    if (!isRecord(payload) || !hasOnlyKeys(payload, ["cardInstanceId"]) || !isId(payload.cardInstanceId)) {
      return rejection("INVALID_PAYLOAD", `${input.commandType} requires cardInstanceId`, input.commandId);
    }
    if (!state.cardInstances[payload.cardInstanceId]) {
      return rejection("UNKNOWN_CARD_INSTANCE", "cardInstanceId does not exist", input.commandId);
    }
    if (!state.cardZones.hands[input.playerId].includes(payload.cardInstanceId)) {
      return rejection("CARD_NOT_IN_HAND", "cardInstanceId is not in the player's hand", input.commandId);
    }
    return { ok: true, kind: "NEW", command: { ...input, payload: { ...payload } } as Command };
  }

  if (input.commandType === "SELECT_RESPONSE") {
    if (!isRecord(payload) || !hasOnlyKeys(payload, ["cardInstanceId", "responseMode"]) || !isId(payload.cardInstanceId) || payload.responseMode !== "RESPONSE") {
      return rejection("INVALID_PAYLOAD", "SELECT_RESPONSE requires cardInstanceId and responseMode=RESPONSE", input.commandId);
    }
    if (!state.cardInstances[payload.cardInstanceId]) {
      return rejection("UNKNOWN_CARD_INSTANCE", "cardInstanceId does not exist", input.commandId);
    }
    if (!state.cardZones.hands[input.playerId].includes(payload.cardInstanceId)) {
      return rejection("CARD_NOT_IN_HAND", "cardInstanceId is not in the player's hand", input.commandId);
    }
    if (options.cardConditionValidator) {
      const condition = options.cardConditionValidator({
        state,
        playerId: input.playerId,
        cardInstanceId: payload.cardInstanceId,
        mode: "RESPONSE",
      });
      if (!condition.ok) return rejection(condition.code, condition.message, input.commandId);
    }
    return { ok: true, kind: "NEW", command: { ...input, payload: { ...payload } } as Command };
  }

  if (!isEmptyPayload(payload)) {
    return rejection("INVALID_PAYLOAD", `${input.commandType} payload must be empty`, input.commandId);
  }
  return { ok: true, kind: "NEW", command: { ...input, payload: {} } as Command };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
