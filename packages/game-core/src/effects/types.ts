import type {
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  ScoreModifierKind,
  ShieldScope,
  StatModifierName,
} from "../state/types.ts";

export type EffectCommandType =
  | "DAMAGE_PLAYER"
  | "HEAL_PLAYER"
  | "PAY_HP"
  | "ADD_SHIELD"
  | "REDUCE_INCOMING_DAMAGE"
  | "REFLECT_DAMAGE"
  | "DRAW_CARD"
  | "DISCARD_CARD"
  | "DAMAGE_WORLD"
  | "RESTORE_WORLD"
  | "SET_FIELD"
  | "CLEAR_FIELD"
  | "MODIFY_STAT_UNTIL_TURN_END"
  | "MODIFY_NEXT_ACTION"
  | "REVEAL_PUBLIC_INFORMATION"
  | "ADD_SCORE_MODIFIER";

export type EffectSourceKind = "CARD" | "FIELD" | "WORLD_LAW" | "SYSTEM";
export type EffectMode = "RELEASE" | "RESTRAIN" | "RESPONSE" | "SYSTEM";
export type AttributionPolicy =
  | "SOURCE_OWNER"
  | "ORIGINAL_CARD_OWNER"
  | "TARGET_PLAYER"
  | "NO_LEDGER"
  | "SYSTEM_LEDGER";
export type ExecutionTiming = "IMMEDIATE" | "AFTER_RESPONSE_MODIFIERS" | "WORLD_LAW_PHASE" | "TERMINAL_PHASE";

export interface EffectSource {
  readonly sourceKind: EffectSourceKind;
  readonly ownerPlayerId: PlayerId | null;
  readonly cardDefinitionId?: CardDefinitionId;
  readonly cardInstanceId?: CardInstanceId;
  readonly fieldDefinitionId?: CardDefinitionId;
  readonly worldLawId?: string;
  readonly mode: EffectMode;
}

export type EffectTarget =
  | { readonly targetKind: "PLAYER"; readonly playerId: PlayerId }
  | { readonly targetKind: "WORLD" }
  | { readonly targetKind: "CURRENT_PENDING_ATTACK"; readonly pendingAttackId: string }
  | { readonly targetKind: "CURRENT_FIELD" }
  | { readonly targetKind: "SELF_HAND"; readonly playerId: PlayerId }
  | { readonly targetKind: "PUBLIC_INFORMATION" }
  | { readonly targetKind: "SCORE_LEDGER" }
  | { readonly targetKind: "NONE" };

export interface DamagePlayerPayload {
  readonly amount: number;
  readonly damageKind: "DIRECT" | "REFLECTION" | "FRAGILE_WORLD" | "WORLD_LAW";
}

export interface HealPlayerPayload {
  readonly amount: number;
  readonly allowRevive: false;
}

export interface PayHpPayload {
  readonly amount: number;
  readonly minimumRemainingHp: number;
}

export interface AddShieldPayload {
  readonly amount: number;
  readonly scope: ShieldScope;
  readonly pendingAttackId?: string;
  readonly expiresAfterTurnSequence?: number;
}

export interface ReduceIncomingDamagePayload {
  readonly amount: number;
}

export interface ReflectDamagePayload {
  readonly amount: number;
  readonly pendingAttackId: string;
}

export interface DrawCardPayload {
  readonly count: number;
  readonly reason: "NORMAL_REFILL" | "WORLD_LAW_50" | "CARD_EFFECT";
}

export interface DiscardCardPayload {
  readonly selection: {
    readonly selectionKind: "EXPLICIT_CARD_INSTANCE" | "NEWEST_CARD_INSTANCE" | "OLDEST_CARD_INSTANCE";
    readonly cardInstanceId?: CardInstanceId;
  };
  readonly reason: "CARD_EFFECT" | "OVERFLOW" | "TIMEOUT";
}

export interface DamageWorldPayload {
  readonly amount: number;
  readonly reason: "CARD_RELEASE" | "CARD_RESPONSE" | "FIELD_EFFECT" | "WORLD_LAW";
}

export interface RestoreWorldPayload {
  readonly amount: number;
  readonly reason: "CARD_RELEASE" | "CARD_RESPONSE" | "FIELD_EFFECT" | "WORLD_LAW";
}

export interface SetFieldPayload {
  readonly fieldDefinitionId: CardDefinitionId;
  readonly ownerPlayerId: PlayerId;
  readonly expiresAfterTurnSequence: number;
}

export interface ClearFieldPayload {
  readonly reason: "CARD_RELEASE" | "CARD_EFFECT" | "WORLD_LAW";
}

export interface ModifyStatUntilTurnEndPayload {
  readonly stat: StatModifierName;
  readonly delta: number;
  readonly expiresAfterTurnSequence: number;
}

export interface ModifyNextActionPayload {
  readonly stat: "DEFENSE_VALUE" | "INCOMING_DAMAGE_REDUCTION" | "ACTION_DAMAGE";
  readonly delta: number;
  readonly consumeWhen: "NEXT_DEFENSE_CARD" | "NEXT_APPLICABLE_ATTACK" | "NEXT_ACTION";
}

export interface RevealPublicInformationPayload {
  readonly informationKind: "CARD_PLAYED" | "CARD_DISCARDED" | "WORLD_THRESHOLD" | "FIELD_CHANGED" | "DRAW_OCCURRED" | "MATCH_FINISHED";
  readonly threshold?: number;
}

export interface AddScoreModifierPayload {
  readonly playerId: PlayerId;
  readonly modifierKind: ScoreModifierKind;
  readonly amount: number;
}

export type EffectPayload =
  | DamagePlayerPayload
  | HealPlayerPayload
  | PayHpPayload
  | AddShieldPayload
  | ReduceIncomingDamagePayload
  | ReflectDamagePayload
  | DrawCardPayload
  | DiscardCardPayload
  | DamageWorldPayload
  | RestoreWorldPayload
  | SetFieldPayload
  | ClearFieldPayload
  | ModifyStatUntilTurnEndPayload
  | ModifyNextActionPayload
  | RevealPublicInformationPayload
  | AddScoreModifierPayload;

export interface EffectCommand {
  readonly effectId: string;
  readonly commandType: EffectCommandType;
  readonly source: EffectSource;
  readonly target: EffectTarget;
  readonly payload: EffectPayload;
  readonly attributionPolicy: AttributionPolicy;
  readonly executionTiming: ExecutionTiming;
}

export type EffectResultStatus = "APPLIED" | "NO_OP" | "REJECTED" | "INVALID_MATCH";

export type EffectRejectionCode =
  | "EFFECT_UNKNOWN_TYPE"
  | "EFFECT_DUPLICATE_ID"
  | "EFFECT_BAD_SOURCE"
  | "EFFECT_BAD_TARGET"
  | "EFFECT_BAD_INTEGER"
  | "EFFECT_OUT_OF_RANGE"
  | "EFFECT_MISSING_FIELD"
  | "EFFECT_CONDITION_NOT_MET"
  | "EFFECT_PENDING_ATTACK_REQUIRED"
  | "EFFECT_NO_ACTIVE_FIELD"
  | "EFFECT_REVIVE_FORBIDDEN"
  | "EFFECT_SECRET_DATA"
  | "EFFECT_CLIENT_VALUE"
  | "EFFECT_REACTION_LIMIT"
  | "EFFECT_QUEUE_LIMIT"
  | "EFFECT_STATE_INCONSISTENT";

export interface EffectExecutionResult {
  readonly effectId: string;
  readonly commandType: EffectCommandType;
  readonly status: EffectResultStatus;
  readonly requested?: number;
  readonly effective?: number;
  readonly before: Readonly<Record<string, number | string | boolean | null>>;
  readonly after?: Readonly<Record<string, number | string | boolean | null>>;
  readonly rejectionCode?: EffectRejectionCode;
  readonly spawnedEffectIds: readonly string[];
  readonly eventTypes: readonly string[];
}

export interface EffectEvent {
  readonly type: string;
  readonly effectId: string;
  readonly commandType: EffectCommandType;
  readonly details: Readonly<Record<string, number | string | boolean | null>>;
}
