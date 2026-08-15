import type {
  AcceptDamageCommand,
  Command,
  CommandType,
  DiscardForActionCommand,
  DiscardOverflowCommand,
  PlayCardCommand,
  SurrenderCommand,
  SelectResponseCommand,
  TimeoutDefaultActionCommand,
} from "./commands/types.ts";
import type {
  DiscardCardPayload,
  EmptyPayload,
  PlayCardPayload,
  SelectResponsePayload,
} from "./commands/types.ts";
import { assertGameState } from "./state/invariants.ts";
import type { GameState, PlayerId } from "./state/types.ts";
import type { ReplayCommandExecution } from "./replay.ts";
import { hashGameState } from "./hash/state-hash.ts";
import type { StateViewer } from "./public-state.ts";

export interface PlayCardPreviewIntent {
  readonly commandType: "PLAY_CARD";
  readonly playerId: PlayerId;
  readonly payload: PlayCardPayload;
}

export interface DiscardForActionPreviewIntent {
  readonly commandType: "DISCARD_FOR_ACTION";
  readonly playerId: PlayerId;
  readonly payload: DiscardCardPayload;
}

export interface DiscardOverflowPreviewIntent {
  readonly commandType: "DISCARD_OVERFLOW";
  readonly playerId: PlayerId;
  readonly payload: DiscardCardPayload;
}

export interface SelectResponsePreviewIntent {
  readonly commandType: "SELECT_RESPONSE";
  readonly playerId: PlayerId;
  readonly payload: SelectResponsePayload;
}

export interface AcceptDamagePreviewIntent {
  readonly commandType: "ACCEPT_DAMAGE";
  readonly playerId: PlayerId;
  readonly payload: EmptyPayload;
}

export interface SurrenderPreviewIntent {
  readonly commandType: "SURRENDER";
  readonly playerId: PlayerId;
  readonly payload: EmptyPayload;
}

export interface TimeoutDefaultActionPreviewIntent {
  readonly commandType: "TIMEOUT_DEFAULT_ACTION";
  readonly playerId: PlayerId;
  readonly payload: EmptyPayload;
}

/** A preview intentionally contains no commandId or expectedRevision envelope. */
export type PreviewCommandIntent =
  | PlayCardPreviewIntent
  | DiscardForActionPreviewIntent
  | DiscardOverflowPreviewIntent
  | SelectResponsePreviewIntent
  | AcceptDamagePreviewIntent
  | SurrenderPreviewIntent
  | TimeoutDefaultActionPreviewIntent;

export type PreviewUncertainty = "OPPONENT_RESPONSE" | "HIDDEN_DRAW_IDENTITY";

export interface PreviewDelta {
  readonly playerHitPointDeltas: Readonly<Record<PlayerId, number>>;
  readonly handCountDeltas: Readonly<Record<PlayerId, number>>;
  readonly worldDurabilityDelta: number;
  readonly crossedWorldThresholds: readonly number[];
  readonly phaseAfter: GameState["phase"];
  readonly wouldFinishMatch: boolean;
}

export type PublicPreviewRejectionCode =
  | "VIEWER_NOT_PLAYER"
  | "PLAYER_MISMATCH"
  | "CARD_UNAVAILABLE"
  | "NOT_YOUR_TURN"
  | "COMMAND_NOT_ALLOWED"
  | "INVALID_TARGET"
  | "CONDITION_NOT_MET"
  | "MATCH_FINISHED"
  | "COMMAND_NOT_PREVIEWABLE"
  | "INVALID_INTENT";

export type PreviewRejectionCode = PublicPreviewRejectionCode;

export type PreviewResult =
  | {
      readonly status: "READY";
      readonly certainty: "EXACT" | "PARTIAL";
      readonly basedOnRevision: number;
      readonly delta: PreviewDelta;
      readonly uncertainties: readonly PreviewUncertainty[];
      readonly pendingAttackBaseDamage?: number;
    }
  | {
      readonly status: "REJECTED";
      readonly basedOnRevision: number;
      readonly code: PublicPreviewRejectionCode;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly basedOnRevision: number;
      readonly reason: "RANDOM_DEPENDENT" | "UNSAFE_SECRET_DEPENDENCY" | "INTERNAL_INCONSISTENCY";
    };

export type PreviewExecutor = (state: GameState, command: Command) => ReplayCommandExecution;

const COMMAND_TYPES: readonly CommandType[] = [
  "PLAY_CARD",
  "DISCARD_FOR_ACTION",
  "DISCARD_OVERFLOW",
  "SELECT_RESPONSE",
  "ACCEPT_DAMAGE",
  "SURRENDER",
  "TIMEOUT_DEFAULT_ACTION",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isPreviewIntent(value: unknown): value is PreviewCommandIntent {
  if (!isRecord(value) || !hasOnlyKeys(value, ["commandType", "playerId", "payload"])) return false;
  return typeof value.commandType === "string"
    && COMMAND_TYPES.includes(value.commandType as CommandType)
    && typeof value.playerId === "string"
    && "payload" in value;
}

function viewerPlayerId(viewer: unknown): PlayerId | null {
  if (!isRecord(viewer) || viewer.kind !== "PLAYER" || typeof viewer.playerId !== "string") return null;
  return viewer.playerId;
}

function rejection(basedOnRevision: number, code: PublicPreviewRejectionCode): PreviewResult {
  return { status: "REJECTED", basedOnRevision, code };
}

function unavailable(
  basedOnRevision: number,
  reason: "RANDOM_DEPENDENT" | "UNSAFE_SECRET_DEPENDENCY" | "INTERNAL_INCONSISTENCY",
): PreviewResult {
  return { status: "UNAVAILABLE", basedOnRevision, reason };
}

function commandCardInstanceIds(intent: PreviewCommandIntent): readonly string[] | null {
  if (!isRecord(intent.payload)) return null;
  const ids: string[] = [];
  if (intent.commandType === "PLAY_CARD") {
    if (typeof intent.payload.cardInstanceId !== "string") return null;
    ids.push(intent.payload.cardInstanceId);
    if (intent.payload.discardCardInstanceId !== undefined) {
      if (typeof intent.payload.discardCardInstanceId !== "string") return null;
      ids.push(intent.payload.discardCardInstanceId);
    }
    return ids;
  }
  if (intent.commandType === "DISCARD_FOR_ACTION" || intent.commandType === "DISCARD_OVERFLOW" || intent.commandType === "SELECT_RESPONSE") {
    if (typeof intent.payload.cardInstanceId !== "string") return null;
    return [intent.payload.cardInstanceId];
  }
  return [];
}

function cardIsAvailableToPlayer(state: GameState, playerId: PlayerId, cardInstanceId: string): boolean {
  return Boolean(state.cardInstances[cardInstanceId]) && state.cardZones.hands[playerId]?.includes(cardInstanceId) === true;
}

function publicRejectionCode(code: string): PublicPreviewRejectionCode {
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

function internalCommandId(state: GameState, commandType: CommandType): string {
  const prefix = `preview.${state.revision}.${state.turnSequence}.${commandType}`;
  let suffix = 1;
  let commandId = `${prefix}.${String(suffix).padStart(4, "0")}`;
  while (state.commandHistory[commandId]) {
    suffix += 1;
    commandId = `${prefix}.${String(suffix).padStart(4, "0")}`;
  }
  return commandId;
}

function buildCommand(state: GameState, intent: PreviewCommandIntent): Command {
  const base = {
    commandId: internalCommandId(state, intent.commandType),
    playerId: intent.playerId,
    expectedRevision: state.revision,
  };
  switch (intent.commandType) {
    case "PLAY_CARD":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as PlayCardCommand;
    case "DISCARD_FOR_ACTION":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as DiscardForActionCommand;
    case "DISCARD_OVERFLOW":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as DiscardOverflowCommand;
    case "SELECT_RESPONSE":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as SelectResponseCommand;
    case "ACCEPT_DAMAGE":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as AcceptDamageCommand;
    case "SURRENDER":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as SurrenderCommand;
    case "TIMEOUT_DEFAULT_ACTION":
      return { ...base, commandType: intent.commandType, payload: intent.payload } as TimeoutDefaultActionCommand;
  }
}

function snapshotCommandHistory(state: GameState): string {
  return JSON.stringify(state.commandHistory);
}

function createDelta(before: GameState, after: GameState): PreviewDelta {
  const playerHitPointDeltas: Record<PlayerId, number> = {};
  const handCountDeltas: Record<PlayerId, number> = {};
  for (const playerId of before.initialPlayerOrder) {
    const beforePlayer = before.players[playerId];
    const afterPlayer = after.players[playerId];
    if (!beforePlayer || !afterPlayer) throw new Error(`missing player in preview result: ${playerId}`);
    playerHitPointDeltas[playerId] = afterPlayer.hitPoints - beforePlayer.hitPoints;
    handCountDeltas[playerId] = after.cardZones.hands[playerId].length - before.cardZones.hands[playerId].length;
  }
  const crossedWorldThresholds = after.world.triggeredThresholds.filter(
    (threshold) => !before.world.triggeredThresholds.includes(threshold),
  );
  return {
    playerHitPointDeltas,
    handCountDeltas,
    worldDurabilityDelta: after.world.durability - before.world.durability,
    crossedWorldThresholds,
    phaseAfter: after.phase,
    wouldFinishMatch: after.phase === "FINISHED",
  };
}

function hasHiddenDraw(before: GameState, after: GameState, events: readonly { readonly type: string }[]): boolean {
  return events.some((event) => event.type === "DRAW_CARD")
    || before.cardZones.drawPile.length !== after.cardZones.drawPile.length;
}

/**
 * Executes a preview through the production command executor and exposes only
 * public deltas. The executor receives a generated envelope, never caller data.
 */
export function previewCommand(
  state: GameState,
  viewer: StateViewer,
  intent: unknown,
  executor: PreviewExecutor,
): PreviewResult {
  const basedOnRevision = typeof state?.revision === "number" ? state.revision : -1;
  if (viewer?.kind !== "PLAYER") return rejection(basedOnRevision, "VIEWER_NOT_PLAYER");
  const viewerId = viewerPlayerId(viewer);
  if (!viewerId || !state?.players?.[viewerId]) return rejection(basedOnRevision, "VIEWER_NOT_PLAYER");
  if (!isPreviewIntent(intent)) return rejection(basedOnRevision, "INVALID_INTENT");
  if (intent.playerId !== viewerId) return rejection(basedOnRevision, "PLAYER_MISMATCH");
  if (intent.commandType === "TIMEOUT_DEFAULT_ACTION") return rejection(basedOnRevision, "COMMAND_NOT_PREVIEWABLE");

  try {
    assertGameState(state);
  } catch {
    return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
  }
  if (state.phase === "FINISHED") return rejection(basedOnRevision, "MATCH_FINISHED");

  const cardIds = commandCardInstanceIds(intent);
  if (cardIds === null) return rejection(basedOnRevision, "INVALID_INTENT");
  if (cardIds.some((cardInstanceId) => !cardIsAvailableToPlayer(state, viewerId, cardInstanceId))) {
    return rejection(basedOnRevision, "CARD_UNAVAILABLE");
  }

  const beforeHash = hashGameState(state);
  const beforeRevision = state.revision;
  const beforeRandomConsumptionCount = state.randomConsumptionCount;
  const beforeHistory = snapshotCommandHistory(state);
  let execution: ReplayCommandExecution;
  try {
    execution = executor(state, buildCommand(state, intent));
  } catch {
    return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
  }

  if (
    state.revision !== beforeRevision
    || state.randomConsumptionCount !== beforeRandomConsumptionCount
    || snapshotCommandHistory(state) !== beforeHistory
    || hashGameState(state) !== beforeHash
  ) {
    return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
  }
  if (!execution || !execution.state) return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
  if (!execution.accepted) return rejection(basedOnRevision, publicRejectionCode(execution.error?.code ?? "UNKNOWN"));
  if (execution.replayed) return unavailable(basedOnRevision, "INTERNAL_INCONSISTENCY");
  if (execution.state.randomConsumptionCount !== beforeRandomConsumptionCount) {
    return unavailable(basedOnRevision, "RANDOM_DEPENDENT");
  }

  try {
    assertGameState(execution.state);
    const delta = createDelta(state, execution.state);
    const uncertainties: PreviewUncertainty[] = [];
    const isWaitingForOpponentResponse = execution.state.phase === "RESPONSE_SELECTION"
      && execution.state.pendingAttack !== null;
    if (isWaitingForOpponentResponse) uncertainties.push("OPPONENT_RESPONSE");
    if (hasHiddenDraw(state, execution.state, execution.events)) uncertainties.push("HIDDEN_DRAW_IDENTITY");
    const result: Extract<PreviewResult, { readonly status: "READY" }> = {
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
  } catch {
    return unavailable(basedOnRevision, "UNSAFE_SECRET_DEPENDENCY");
  }
}
