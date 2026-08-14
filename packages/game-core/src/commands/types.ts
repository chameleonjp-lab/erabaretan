import type { CardInstanceId, CommandId, PlayMode, PlayerId, ResponseMode } from "../state/types.ts";

export type CommandType =
  | "PLAY_CARD"
  | "DISCARD_FOR_ACTION"
  | "DISCARD_OVERFLOW"
  | "SELECT_RESPONSE"
  | "ACCEPT_DAMAGE"
  | "SURRENDER"
  | "TIMEOUT_DEFAULT_ACTION";

export interface CommandBase<Type extends CommandType, Payload> {
  readonly commandId: CommandId;
  readonly playerId: PlayerId;
  readonly expectedRevision: number;
  readonly commandType: Type;
  readonly payload: Payload;
}

export interface PlayCardPayload {
  readonly cardInstanceId: CardInstanceId;
  readonly playMode: PlayMode;
  readonly targetPlayerId?: PlayerId;
}

export interface DiscardCardPayload {
  readonly cardInstanceId: CardInstanceId;
}

export interface SelectResponsePayload {
  readonly cardInstanceId: CardInstanceId;
  readonly responseMode: ResponseMode;
}

export type EmptyPayload = Readonly<Record<string, never>>;

export type PlayCardCommand = CommandBase<"PLAY_CARD", PlayCardPayload>;
export type DiscardForActionCommand = CommandBase<"DISCARD_FOR_ACTION", DiscardCardPayload>;
export type DiscardOverflowCommand = CommandBase<"DISCARD_OVERFLOW", DiscardCardPayload>;
export type SelectResponseCommand = CommandBase<"SELECT_RESPONSE", SelectResponsePayload>;
export type AcceptDamageCommand = CommandBase<"ACCEPT_DAMAGE", EmptyPayload>;
export type SurrenderCommand = CommandBase<"SURRENDER", EmptyPayload>;
export type TimeoutDefaultActionCommand = CommandBase<"TIMEOUT_DEFAULT_ACTION", EmptyPayload>;

export type Command =
  | PlayCardCommand
  | DiscardForActionCommand
  | DiscardOverflowCommand
  | SelectResponseCommand
  | AcceptDamageCommand
  | SurrenderCommand
  | TimeoutDefaultActionCommand;
