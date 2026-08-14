import type { Command } from "./commands/types.ts";
import type { CommandValidationOptions } from "./commands/validate.ts";
import type { GameState, PlayerId } from "./state/types.ts";
import { applyCommand } from "./reduce-command.ts";
import { hashGameState } from "./hash/state-hash.ts";

export const REPLAY_FORMAT_VERSION = "replay.alpha-12.v1" as const;

export interface ReplayRecord {
  readonly replayFormatVersion: string;
  readonly engineVersion: string;
  readonly rulesetId: string;
  readonly catalogHash: string;
  readonly rngAlgorithmVersion: string;
  readonly shuffleAlgorithmVersion: string;
  readonly seed: string;
  readonly initialPlayerOrder: readonly PlayerId[];
  readonly acceptedCommands: readonly Command[];
  readonly expectedFinalStateHash: string;
  readonly expectedEndKind: GameState["terminalFlags"]["endKind"];
  /** Required evidence for every accepted command in replay.alpha-12.v1. */
  readonly expectedEventTypes: readonly string[];
  readonly expectedRevisions: readonly number[];
  readonly expectedRandomConsumptionCounts: readonly number[];
  readonly expectedStateHashes: readonly string[];
}

export type ReplayFailureCode =
  | "REPLAY_FORMAT_MISMATCH"
  | "REPLAY_METADATA_MISMATCH"
  | "REPLAY_COMMAND_REJECTED"
  | "REPLAY_DUPLICATE_COMMAND"
  | "REPLAY_REVISION_MISMATCH"
  | "REPLAY_RANDOM_CONSUMPTION_MISMATCH"
  | "REPLAY_STATE_SNAPSHOT_MISMATCH"
  | "REPLAY_EVENT_MISMATCH"
  | "REPLAY_END_KIND_MISMATCH"
  | "REPLAY_STATE_HASH_MISMATCH";

export interface ReplayFailure {
  readonly ok: false;
  readonly code: ReplayFailureCode;
  readonly message: string;
  readonly commandIndex: number | null;
  readonly state: GameState;
}

export interface ReplaySuccess {
  readonly ok: true;
  readonly state: GameState;
  readonly finalStateHash: string;
  readonly events: readonly { readonly type: string }[];
}

export type ReplayVerificationResult = ReplaySuccess | ReplayFailure;

export interface ReplayCommandExecution {
  readonly accepted: boolean;
  readonly replayed: boolean;
  readonly state: GameState;
  readonly events: readonly { readonly type: string }[];
  readonly error?: { readonly code: string; readonly message: string };
}

export type ReplayCommandExecutor = (
  state: GameState,
  command: Command,
  options?: CommandValidationOptions,
) => ReplayCommandExecution;

function metadataMatches(state: GameState, replay: ReplayRecord): boolean {
  return state.engineVersion === replay.engineVersion
    && state.ruleset.rulesetId === replay.rulesetId
    && state.catalogHash === replay.catalogHash
    && state.rngAlgorithmVersion === replay.rngAlgorithmVersion
    && state.shuffleAlgorithmVersion === replay.shuffleAlgorithmVersion
    && state.seed === replay.seed
    && state.initialPlayerOrder.length === replay.initialPlayerOrder.length
    && state.initialPlayerOrder.every((playerId, index) => playerId === replay.initialPlayerOrder[index]);
}

function failure(
  code: ReplayFailureCode,
  message: string,
  state: GameState,
  commandIndex: number | null,
): ReplayFailure {
  return { ok: false, code, message, commandIndex, state };
}

function flattenEventTypes(events: readonly { readonly type: string }[]): string[] {
  return events.map((event) => event.type);
}

const defaultReplayExecutor: ReplayCommandExecutor = (state, command, options) => applyCommand(state, command, options);

export function verifyReplay(
  initialState: GameState,
  replay: ReplayRecord,
  options: {
    readonly commandValidationOptions?: CommandValidationOptions;
    readonly executeCommand?: ReplayCommandExecutor;
  } = {},
): ReplayVerificationResult {
  if (replay.replayFormatVersion !== REPLAY_FORMAT_VERSION) {
    return failure("REPLAY_FORMAT_MISMATCH", `unsupported replay format: ${replay.replayFormatVersion}`, initialState, null);
  }
  if (!metadataMatches(initialState, replay)) {
    return failure("REPLAY_METADATA_MISMATCH", "replay metadata does not match the initial state", initialState, null);
  }
  if (!Array.isArray(replay.expectedRevisions) || replay.expectedRevisions.length !== replay.acceptedCommands.length) {
    return failure("REPLAY_REVISION_MISMATCH", "expectedRevisions must contain one entry per accepted command", initialState, null);
  }
  if (!Array.isArray(replay.expectedRandomConsumptionCounts) || replay.expectedRandomConsumptionCounts.length !== replay.acceptedCommands.length) {
    return failure("REPLAY_RANDOM_CONSUMPTION_MISMATCH", "expectedRandomConsumptionCounts must contain one entry per accepted command", initialState, null);
  }
  if (!Array.isArray(replay.expectedStateHashes) || replay.expectedStateHashes.length !== replay.acceptedCommands.length) {
    return failure("REPLAY_STATE_SNAPSHOT_MISMATCH", "expectedStateHashes must contain one entry per accepted command", initialState, null);
  }
  if (!Array.isArray(replay.expectedEventTypes)) {
    return failure("REPLAY_EVENT_MISMATCH", "expectedEventTypes is required for replay.alpha-12.v1", initialState, null);
  }

  let state = initialState;
  const allEvents: { readonly type: string }[] = [];
  const revisionSnapshots: number[] = [];
  const randomConsumptionSnapshots: number[] = [];
  const stateHashes: string[] = [];
  const executeCommand = options.executeCommand ?? defaultReplayExecutor;
  for (let index = 0; index < replay.acceptedCommands.length; index += 1) {
    const result = executeCommand(state, replay.acceptedCommands[index], options.commandValidationOptions);
    if (!result.accepted) {
      return failure("REPLAY_COMMAND_REJECTED", `replay command ${index} was rejected: ${result.error?.code ?? "UNKNOWN"}`, state, index);
    }
    if (result.replayed) {
      return failure("REPLAY_DUPLICATE_COMMAND", `replay command ${index} was already accepted`, state, index);
    }
    state = result.state;
    revisionSnapshots.push(state.revision);
    randomConsumptionSnapshots.push(state.randomConsumptionCount);
    stateHashes.push(hashGameState(state));
    allEvents.push(...result.events);
    if (replay.expectedRevisions[index] !== state.revision) {
      return failure("REPLAY_REVISION_MISMATCH", `replay command ${index} produced revision ${state.revision}`, state, index);
    }
    if (replay.expectedRandomConsumptionCounts[index] !== state.randomConsumptionCount) {
      return failure("REPLAY_RANDOM_CONSUMPTION_MISMATCH", `replay command ${index} produced randomConsumptionCount ${state.randomConsumptionCount}`, state, index);
    }
    if (replay.expectedStateHashes[index] !== stateHashes[index]) {
      return failure("REPLAY_STATE_SNAPSHOT_MISMATCH", `replay command ${index} produced an unexpected state hash`, state, index);
    }
  }

  if (replay.expectedRevisions.length !== revisionSnapshots.length) {
    return failure("REPLAY_REVISION_MISMATCH", "expectedRevisions length does not match acceptedCommands", state, null);
  }
  if (replay.expectedRandomConsumptionCounts.length !== randomConsumptionSnapshots.length || randomConsumptionSnapshots.some((count, index) => count !== replay.expectedRandomConsumptionCounts[index])) {
    return failure("REPLAY_RANDOM_CONSUMPTION_MISMATCH", "randomConsumptionCount does not match the replay snapshot", state, null);
  }
  if (replay.expectedStateHashes.length !== stateHashes.length || stateHashes.some((hash, index) => hash !== replay.expectedStateHashes[index])) {
    return failure("REPLAY_STATE_SNAPSHOT_MISMATCH", "a revision state hash does not match the replay snapshot", state, null);
  }
  const actualEventTypes = flattenEventTypes(allEvents);
  if (actualEventTypes.length !== replay.expectedEventTypes.length || actualEventTypes.some((type, index) => type !== replay.expectedEventTypes[index])) {
    return failure("REPLAY_EVENT_MISMATCH", "replay event order does not match expectedEventTypes", state, null);
  }
  if (state.terminalFlags.endKind !== replay.expectedEndKind) {
    return failure("REPLAY_END_KIND_MISMATCH", `replay ended with ${state.terminalFlags.endKind}`, state, null);
  }

  const finalStateHash = hashGameState(state);
  if (finalStateHash !== replay.expectedFinalStateHash) {
    return failure("REPLAY_STATE_HASH_MISMATCH", `expected ${replay.expectedFinalStateHash}, got ${finalStateHash}`, state, null);
  }
  return { ok: true, state, finalStateHash, events: allEvents };
}

export function createReplayRecord(
  initialState: GameState,
  acceptedCommands: readonly Command[],
  finalState: GameState,
  options: {
    readonly expectedEventTypes?: readonly string[];
    readonly expectedRevisions?: readonly number[];
    readonly expectedRandomConsumptionCounts?: readonly number[];
    readonly expectedStateHashes?: readonly string[];
    readonly executeCommand?: ReplayCommandExecutor;
    readonly commandValidationOptions?: CommandValidationOptions;
  } = {},
): ReplayRecord {
  const executeCommand = options.executeCommand ?? defaultReplayExecutor;
  let trajectory = initialState;
  const generatedRevisions: number[] = [];
  const generatedRandomConsumptionCounts: number[] = [];
  const generatedStateHashes: string[] = [];
  const generatedEventTypes: string[] = [];
  for (let index = 0; index < acceptedCommands.length; index += 1) {
    const execution = executeCommand(trajectory, acceptedCommands[index], options.commandValidationOptions);
    if (!execution.accepted || execution.replayed) {
      throw new Error(`cannot create replay record: command ${index} was not a new accepted command`);
    }
    trajectory = execution.state;
    generatedRevisions.push(trajectory.revision);
    generatedRandomConsumptionCounts.push(trajectory.randomConsumptionCount);
    generatedStateHashes.push(hashGameState(trajectory));
    generatedEventTypes.push(...flattenEventTypes(execution.events));
  }
  const record: ReplayRecord = {
    replayFormatVersion: REPLAY_FORMAT_VERSION,
    engineVersion: initialState.engineVersion,
    rulesetId: initialState.ruleset.rulesetId,
    catalogHash: initialState.catalogHash,
    rngAlgorithmVersion: initialState.rngAlgorithmVersion,
    shuffleAlgorithmVersion: initialState.shuffleAlgorithmVersion,
    seed: initialState.seed,
    initialPlayerOrder: [...initialState.initialPlayerOrder],
    acceptedCommands: [...acceptedCommands],
    expectedFinalStateHash: hashGameState(finalState),
    expectedEndKind: finalState.terminalFlags.endKind,
    expectedEventTypes: options.expectedEventTypes ? [...options.expectedEventTypes] : generatedEventTypes,
    expectedRevisions: options.expectedRevisions ? [...options.expectedRevisions] : generatedRevisions,
    expectedRandomConsumptionCounts: options.expectedRandomConsumptionCounts
      ? [...options.expectedRandomConsumptionCounts]
      : generatedRandomConsumptionCounts,
    expectedStateHashes: options.expectedStateHashes ? [...options.expectedStateHashes] : generatedStateHashes,
  };
  const verification = verifyReplay(initialState, record, {
    executeCommand: options.executeCommand,
    commandValidationOptions: options.commandValidationOptions,
  });
  if (verification.ok === false) throw new Error(`cannot create replay record: ${verification.code}: ${verification.message}`);
  return record;
}

export const replayCommands = verifyReplay;
export const replayGame = verifyReplay;
