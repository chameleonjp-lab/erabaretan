import { assertGameState } from "../state/invariants.ts";
import { finalizeTerminalState } from "../terminal/resolve.ts";
import type {
  CardInstanceState,
  GameState,
  PendingAttackState,
  PlayerId,
  PlayerState,
  ScoreModifierState,
  ShieldState,
  StatModifierState,
} from "../state/types.ts";
import type {
  AddScoreModifierPayload,
  AddShieldPayload,
  DamagePlayerPayload,
  DamageWorldPayload,
  DiscardCardPayload,
  DrawCardPayload,
  EffectCommand,
  EffectCommandType,
  EffectEvent,
  EffectExecutionResult,
  EffectPayload,
  EffectRejectionCode,
  EffectTarget,
  HealPlayerPayload,
  ModifyNextActionPayload,
  ModifyStatUntilTurnEndPayload,
  PayHpPayload,
  ReduceIncomingDamagePayload,
  ReflectDamagePayload,
  RestoreWorldPayload,
  SetFieldPayload,
} from "./types.ts";

export interface EffectQueueResult {
  readonly committed: boolean;
  readonly state: GameState;
  readonly results: readonly EffectExecutionResult[];
  readonly events: readonly EffectEvent[];
  readonly rejectionCode?: EffectRejectionCode;
}

type Scalar = number | string | boolean | null;

const EFFECT_ID_PATTERN = /^effect\.[A-Za-z0-9._:-]+\.[0-9]{4}$/;
const EFFECT_TYPES: readonly EffectCommandType[] = [
  "DAMAGE_PLAYER",
  "HEAL_PLAYER",
  "PAY_HP",
  "ADD_SHIELD",
  "REDUCE_INCOMING_DAMAGE",
  "REFLECT_DAMAGE",
  "DRAW_CARD",
  "DISCARD_CARD",
  "DAMAGE_WORLD",
  "RESTORE_WORLD",
  "SET_FIELD",
  "CLEAR_FIELD",
  "MODIFY_STAT_UNTIL_TURN_END",
  "MODIFY_NEXT_ACTION",
  "REVEAL_PUBLIC_INFORMATION",
  "ADD_SCORE_MODIFIER",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function before(values: Record<string, Scalar> = {}): Readonly<Record<string, Scalar>> {
  return values;
}

function result(
  effect: EffectCommand,
  status: EffectExecutionResult["status"],
  values: {
    requested?: number;
    effective?: number;
    before?: Record<string, Scalar>;
    after?: Record<string, Scalar>;
    ledgerDelta?: EffectExecutionResult["ledgerDelta"];
    rejectionCode?: EffectRejectionCode;
    eventTypes?: readonly string[];
  } = {},
): EffectExecutionResult {
  return {
    effectId: effect.effectId,
    commandType: effect.commandType,
    status,
    requested: values.requested,
    effective: values.effective,
    before: before(values.before),
    after: values.after,
    ledgerDelta: values.ledgerDelta,
    rejectionCode: values.rejectionCode,
    spawnedEffectIds: [],
    eventTypes: values.eventTypes ?? [],
  };
}

function event(effect: EffectCommand, type: string, details: Record<string, Scalar> = {}): EffectEvent {
  return { type, effectId: effect.effectId, commandType: effect.commandType, details };
}

function reject(effect: EffectCommand, code: EffectRejectionCode, values: Record<string, Scalar> = {}) {
  return { state: null, result: result(effect, "REJECTED", { before: values, rejectionCode: code }) };
}

function targetPlayerId(target: EffectTarget): PlayerId | null {
  if (target.targetKind === "PLAYER" || target.targetKind === "SELF_HAND") return target.playerId;
  return null;
}

function updatePlayer(state: GameState, playerId: PlayerId, update: (player: PlayerState) => PlayerState): GameState {
  const player = state.players[playerId];
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return { ...state, players: { ...state.players, [playerId]: update(player) } };
}

function updatePlayerAndHand(
  state: GameState,
  playerId: PlayerId,
  hand: readonly string[],
  updateCardInstances: (cards: Readonly<Record<string, CardInstanceState>>) => Readonly<Record<string, CardInstanceState>>,
): GameState {
  const next = updatePlayer(state, playerId, (player) => ({ ...player, hand: [...hand] }));
  return {
    ...next,
    cardZones: { ...next.cardZones, hands: { ...next.cardZones.hands, [playerId]: [...hand] } },
    cardInstances: updateCardInstances(next.cardInstances),
  };
}

function validateEffectCommand(state: GameState, input: unknown): { ok: true; effect: EffectCommand } | { ok: false; code: EffectRejectionCode } {
  if (!isRecord(input)) return { ok: false, code: "EFFECT_STATE_INCONSISTENT" };
  if (typeof input.effectId !== "string" || !EFFECT_ID_PATTERN.test(input.effectId)) {
    return { ok: false, code: "EFFECT_MISSING_FIELD" };
  }
  if (typeof input.commandType !== "string" || !EFFECT_TYPES.includes(input.commandType as EffectCommandType)) {
    return { ok: false, code: "EFFECT_UNKNOWN_TYPE" };
  }
  if (!isRecord(input.source) || !isRecord(input.target) || !isRecord(input.payload)) {
    return { ok: false, code: "EFFECT_MISSING_FIELD" };
  }
  const source = input.source;
  const target = input.target;
  const payload = input.payload;
  if (![
    "CARD",
    "FIELD",
    "WORLD_LAW",
    "SYSTEM",
  ].includes(String(source.sourceKind)) || !["RELEASE", "RESTRAIN", "RESPONSE", "SYSTEM"].includes(String(source.mode))) {
    return { ok: false, code: "EFFECT_BAD_SOURCE" };
  }
  if (!["SOURCE_OWNER", "ORIGINAL_CARD_OWNER", "TARGET_PLAYER", "NO_LEDGER", "SYSTEM_LEDGER"].includes(String(input.attributionPolicy))) {
    return { ok: false, code: "EFFECT_MISSING_FIELD" };
  }
  if (!["IMMEDIATE", "AFTER_RESPONSE_MODIFIERS", "WORLD_LAW_PHASE", "TERMINAL_PHASE"].includes(String(input.executionTiming))) {
    return { ok: false, code: "EFFECT_MISSING_FIELD" };
  }
  if (source.ownerPlayerId !== null && source.ownerPlayerId !== undefined && !state.players[String(source.ownerPlayerId)]) {
    return { ok: false, code: "EFFECT_BAD_SOURCE" };
  }
  if (source.sourceKind === "CARD" && (!source.ownerPlayerId || typeof source.cardDefinitionId !== "string" || typeof source.cardInstanceId !== "string")) {
    return { ok: false, code: "EFFECT_BAD_SOURCE" };
  }
  if (source.sourceKind === "CARD") {
    const sourceCard = state.cardInstances[String(source.cardInstanceId)];
    if (
      !sourceCard
      || sourceCard.ownerPlayerId !== source.ownerPlayerId
      || sourceCard.cardDefinitionId !== source.cardDefinitionId
    ) {
      return { ok: false, code: "EFFECT_BAD_SOURCE" };
    }
  }
  if (typeof target.targetKind !== "string") return { ok: false, code: "EFFECT_BAD_TARGET" };
  const type = input.commandType as EffectCommandType;
  const playerTargetTypes = new Set(["DAMAGE_PLAYER", "HEAL_PLAYER", "PAY_HP", "REFLECT_DAMAGE", "MODIFY_STAT_UNTIL_TURN_END", "MODIFY_NEXT_ACTION"]);
  if (playerTargetTypes.has(type) && (target.targetKind !== "PLAYER" || !state.players[String(target.playerId)])) {
    return { ok: false, code: "EFFECT_BAD_TARGET" };
  }
  if (type === "ADD_SHIELD" && !["PLAYER", "CURRENT_PENDING_ATTACK"].includes(target.targetKind)) {
    return { ok: false, code: "EFFECT_BAD_TARGET" };
  }
  if (type === "ADD_SHIELD" && target.targetKind === "PLAYER" && !state.players[String(target.playerId)]) {
    return { ok: false, code: "EFFECT_BAD_TARGET" };
  }
  if ((type === "DAMAGE_WORLD" || type === "RESTORE_WORLD") && target.targetKind !== "WORLD") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "REDUCE_INCOMING_DAMAGE" && target.targetKind !== "CURRENT_PENDING_ATTACK") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if ((type === "DRAW_CARD" || type === "DISCARD_CARD") && !["PLAYER", "SELF_HAND"].includes(target.targetKind)) return { ok: false, code: "EFFECT_BAD_TARGET" };
  if ((type === "DRAW_CARD" || type === "DISCARD_CARD") && !state.players[String(target.playerId)]) return { ok: false, code: "EFFECT_BAD_TARGET" };
  if ((type === "SET_FIELD" || type === "CLEAR_FIELD") && target.targetKind !== "CURRENT_FIELD") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "REVEAL_PUBLIC_INFORMATION" && target.targetKind !== "PUBLIC_INFORMATION") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "ADD_SCORE_MODIFIER" && target.targetKind !== "SCORE_LEDGER") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "CLEAR_FIELD" && target.targetKind !== "CURRENT_FIELD") return { ok: false, code: "EFFECT_BAD_TARGET" };

  const amountPayloadTypes = new Set(["DAMAGE_PLAYER", "HEAL_PLAYER", "ADD_SHIELD", "REDUCE_INCOMING_DAMAGE", "REFLECT_DAMAGE", "DAMAGE_WORLD", "RESTORE_WORLD"]);
  if (amountPayloadTypes.has(type) && !isInteger(payload.amount, 1, type === "DAMAGE_WORLD" || type === "RESTORE_WORLD" ? 100 : 30)) {
    return { ok: false, code: typeof payload.amount === "number" ? "EFFECT_OUT_OF_RANGE" : "EFFECT_BAD_INTEGER" };
  }
  if (type === "PAY_HP" && (!isInteger(payload.amount, 1, 29) || !isInteger(payload.minimumRemainingHp, 0, 29))) {
    return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  }
  if (type === "DRAW_CARD" && !isInteger(payload.count, 1, 9)) return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  if (type === "DISCARD_CARD" && (!isRecord(payload.selection) || typeof payload.selection.selectionKind !== "string")) {
    return { ok: false, code: "EFFECT_MISSING_FIELD" };
  }
  if (type === "SET_FIELD" && (!isInteger(payload.expiresAfterTurnSequence, 1, Number.MAX_SAFE_INTEGER) || typeof payload.fieldDefinitionId !== "string" || !state.players[String(payload.ownerPlayerId)])) {
    return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  }
  if (type === "SET_FIELD" && state.ruleset.fieldDefinitionIds && !state.ruleset.fieldDefinitionIds.includes(String(payload.fieldDefinitionId))) {
    return { ok: false, code: "EFFECT_CONDITION_NOT_MET" };
  }
  if (type === "MODIFY_STAT_UNTIL_TURN_END" && (!isInteger(payload.delta, -30, 30) || payload.delta === 0 || !isInteger(payload.expiresAfterTurnSequence, 1, Number.MAX_SAFE_INTEGER))) {
    return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  }
  if (type === "MODIFY_NEXT_ACTION" && (!isInteger(payload.delta, -30, 30) || payload.delta === 0 || typeof payload.consumeWhen !== "string")) {
    return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  }
  if (type === "ADD_SCORE_MODIFIER" && (!isInteger(payload.amount, 1, 100) || !state.players[String(payload.playerId)])) {
    return { ok: false, code: "EFFECT_OUT_OF_RANGE" };
  }
  if (type === "HEAL_PLAYER" && payload.allowRevive !== false) return { ok: false, code: "EFFECT_REVIVE_FORBIDDEN" };
  if (type === "PAY_HP" && source.ownerPlayerId !== target.playerId) return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "REFLECT_DAMAGE" && (target.targetKind !== "PLAYER" || typeof payload.pendingAttackId !== "string")) return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "ADD_SHIELD" && payload.scope === "CURRENT_PENDING_ATTACK" && target.targetKind !== "CURRENT_PENDING_ATTACK" && typeof payload.pendingAttackId !== "string") return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "ADD_SHIELD" && ["NEXT_APPLICABLE_ATTACK", "UNTIL_TURN_SEQUENCE"].includes(String(payload.scope)) && !isInteger(payload.expiresAfterTurnSequence, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "ADD_SHIELD" && target.targetKind === "CURRENT_PENDING_ATTACK" && typeof target.pendingAttackId !== "string") return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "REDUCE_INCOMING_DAMAGE" && typeof target.pendingAttackId !== "string") return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "REFLECT_DAMAGE" && typeof target.playerId !== "string") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "DAMAGE_PLAYER" && !["DIRECT", "REFLECTION", "FRAGILE_WORLD", "WORLD_LAW"].includes(String(payload.damageKind))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "ADD_SHIELD" && !["CURRENT_PENDING_ATTACK", "NEXT_APPLICABLE_ATTACK", "UNTIL_TURN_SEQUENCE"].includes(String(payload.scope))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "ADD_SHIELD" && payload.scope !== "CURRENT_PENDING_ATTACK" && target.targetKind !== "PLAYER") return { ok: false, code: "EFFECT_BAD_TARGET" };
  if (type === "DRAW_CARD" && !["NORMAL_REFILL", "WORLD_LAW_50", "CARD_EFFECT"].includes(String(payload.reason))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "DISCARD_CARD" && (![
    "EXPLICIT_CARD_INSTANCE",
    "NEWEST_CARD_INSTANCE",
    "OLDEST_CARD_INSTANCE",
  ].includes(String(payload.selection?.selectionKind)) || !["CARD_EFFECT", "OVERFLOW", "TIMEOUT"].includes(String(payload.reason)))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if ((type === "DAMAGE_WORLD" || type === "RESTORE_WORLD") && !["CARD_RELEASE", "CARD_RESPONSE", "FIELD_EFFECT", "WORLD_LAW"].includes(String(payload.reason))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "CLEAR_FIELD" && !["CARD_RELEASE", "CARD_EFFECT", "WORLD_LAW"].includes(String(payload.reason))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "MODIFY_STAT_UNTIL_TURN_END" && !["INCOMING_DAMAGE_REDUCTION", "ACTION_DAMAGE"].includes(String(payload.stat))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "MODIFY_NEXT_ACTION" && (![
    "DEFENSE_VALUE",
    "INCOMING_DAMAGE_REDUCTION",
    "ACTION_DAMAGE",
  ].includes(String(payload.stat)) || !["NEXT_DEFENSE_CARD", "NEXT_APPLICABLE_ATTACK", "NEXT_ACTION"].includes(String(payload.consumeWhen)))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "REVEAL_PUBLIC_INFORMATION" && (![
    "CARD_PLAYED",
    "CARD_DISCARDED",
    "WORLD_THRESHOLD",
    "FIELD_CHANGED",
    "DRAW_OCCURRED",
    "MATCH_FINISHED",
  ].includes(String(payload.informationKind)) || (payload.threshold !== undefined && !isInteger(payload.threshold, 0, 100)))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (type === "ADD_SCORE_MODIFIER" && ![
    "WORLD_COLLAPSE_PENALTY",
    "SURVIVAL_BONUS",
    "WORLD_DAMAGE_RESPONSIBILITY",
    "EFFECTIVE_WORLD_RESTORE",
  ].includes(String(payload.modifierKind))) return { ok: false, code: "EFFECT_MISSING_FIELD" };
  if (state.phase === "FINISHED" || state.phase === "JUDGMENT") return { ok: false, code: "EFFECT_CONDITION_NOT_MET" };

  return { ok: true, effect: input as unknown as EffectCommand };
}

function applyDamage(
  state: GameState,
  effect: EffectCommand,
  payload: DamagePlayerPayload,
  bypassDefense: boolean,
) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId) return reject(effect, "EFFECT_BAD_TARGET");
  const player = state.players[playerId];
  if (!player || player.hitPoints <= 0) return reject(effect, "EFFECT_CONDITION_NOT_MET", { hitPoints: player?.hitPoints ?? null });
  const fragileWorldDamage = !bypassDefense && payload.damageKind === "FRAGILE_WORLD";
  if (!bypassDefense && effect.executionTiming === "AFTER_RESPONSE_MODIFIERS" && !state.pendingAttack) {
    return reject(effect, "EFFECT_PENDING_ATTACK_REQUIRED");
  }

  let nextState = state;
  let mitigation = 0;
  let pending = state.pendingAttack;
  let applicableShields: readonly ShieldState[] = [];
  if (!bypassDefense && (effect.executionTiming === "AFTER_RESPONSE_MODIFIERS" || fragileWorldDamage)) {
    if (effect.executionTiming === "AFTER_RESPONSE_MODIFIERS") {
      if (!pending || pending.defendingPlayerId !== playerId) return reject(effect, "EFFECT_BAD_TARGET");
      applicableShields = player.statusEffects.shields.filter((shield) => {
        if (shield.scope === "NEXT_APPLICABLE_ATTACK") return (shield.expiresAfterTurnSequence ?? 0) > state.turnSequence;
        if (shield.scope === "UNTIL_TURN_SEQUENCE") return (shield.expiresAfterTurnSequence ?? 0) > state.turnSequence;
        return shield.pendingAttackId === pending?.pendingAttackId;
      });
      const currentPendingShield = applicableShields
        .filter((shield) => shield.scope === "CURRENT_PENDING_ATTACK")
        .reduce((total, shield) => total + shield.amount, 0);
      const currentDefenseMitigation = pending.currentShield + pending.incomingDamageReduction + currentPendingShield;
      const persistentShield = applicableShields
        .filter((shield) => shield.scope !== "CURRENT_PENDING_ATTACK")
        .reduce((total, shield) => total + shield.amount, 0);
      const penalty = player.statusEffects.nextDefensePenalty;
      const adjustedCurrentDefense = Math.max(0, currentDefenseMitigation - penalty);
      mitigation = Math.min(30, adjustedCurrentDefense + persistentShield);
      const consumedShields = applicableShields.filter((shield) => shield.scope !== "UNTIL_TURN_SEQUENCE");
      const nextStatus = {
        ...player.statusEffects,
        nextDefensePenalty: currentDefenseMitigation > 0 ? 0 : penalty,
        shields: player.statusEffects.shields.filter((shield) => {
          if (consumedShields.includes(shield)) return false;
          if (shield.scope !== "CURRENT_PENDING_ATTACK" && (shield.expiresAfterTurnSequence ?? Number.MAX_SAFE_INTEGER) <= state.turnSequence) return false;
          return true;
        }),
      };
      nextState = updatePlayer(nextState, playerId, (current) => ({ ...current, statusEffects: nextStatus }));
      pending = {
        ...pending,
        currentShield: 0,
        incomingDamageReduction: 0,
      };
      nextState = { ...nextState, pendingAttack: pending };
    } else {
      // Fragile-world self damage is ordinary DAMAGE_PLAYER damage, but it is
      // not the pending attack's damage. It can therefore consume persistent
      // shields without consuming the current response bundle.
      applicableShields = player.statusEffects.shields.filter((shield) => {
        if (shield.scope === "CURRENT_PENDING_ATTACK") return false;
        return (shield.expiresAfterTurnSequence ?? 0) > state.turnSequence;
      });
      mitigation = Math.min(30, applicableShields.reduce((total, shield) => total + shield.amount, 0));
      const consumedShields = applicableShields.filter((shield) => shield.scope !== "UNTIL_TURN_SEQUENCE");
      const nextStatus = {
        ...player.statusEffects,
        shields: player.statusEffects.shields.filter((shield) => {
          if (consumedShields.includes(shield)) return false;
          if (shield.scope !== "CURRENT_PENDING_ATTACK" && (shield.expiresAfterTurnSequence ?? Number.MAX_SAFE_INTEGER) <= state.turnSequence) return false;
          return true;
        }),
      };
      nextState = updatePlayer(nextState, playerId, (current) => ({ ...current, statusEffects: nextStatus }));
    }
  }

  const effective = Math.min(Math.max(payload.amount - mitigation, 0), player.hitPoints);
  const updatedPlayer = nextState.players[playerId];
  nextState = updatePlayer(nextState, playerId, (current) => ({ ...current, hitPoints: current.hitPoints - effective }));
  if (pending && effect.executionTiming === "AFTER_RESPONSE_MODIFIERS") {
    nextState = { ...nextState, pendingAttack: { ...pending, effectiveDamage: effective } };
  }
  const eventTypes = ["DAMAGE_PLAYER_APPLIED"];
  if (updatedPlayer.hitPoints > 0 && updatedPlayer.hitPoints - effective === 0) eventTypes.push("PLAYER_DEFEATED");
  return {
    state: nextState,
    result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", {
      requested: payload.amount,
      effective,
      before: { hitPoints: player.hitPoints },
      after: { hitPoints: player.hitPoints - effective },
      eventTypes,
    }),
    events: eventTypes.map((type) => event(effect, type, { playerId, amount: effective })),
  };
}

function applyPayHp(state: GameState, effect: EffectCommand, payload: PayHpPayload) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId) return reject(effect, "EFFECT_BAD_TARGET");
  const player = state.players[playerId];
  if (player.hitPoints - payload.amount < payload.minimumRemainingHp || player.hitPoints - payload.amount <= 0) {
    return reject(effect, "EFFECT_CONDITION_NOT_MET", { hitPoints: player.hitPoints });
  }
  const nextState = updatePlayer(state, playerId, (current) => ({ ...current, hitPoints: current.hitPoints - payload.amount }));
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: payload.amount, effective: payload.amount, before: { hitPoints: player.hitPoints }, after: { hitPoints: player.hitPoints - payload.amount }, eventTypes: ["PAY_HP_APPLIED"] }),
    events: [event(effect, "PAY_HP_APPLIED", { playerId, amount: payload.amount })],
  };
}

function applyAddShield(state: GameState, effect: EffectCommand, payload: AddShieldPayload) {
  const playerId = effect.target.targetKind === "CURRENT_PENDING_ATTACK"
    ? state.pendingAttack?.defendingPlayerId ?? null
    : targetPlayerId(effect.target);
  if (!playerId) return reject(effect, "EFFECT_BAD_TARGET");
  const player = state.players[playerId];
  if (payload.scope === "CURRENT_PENDING_ATTACK") {
    const pendingAttackId = effect.target.targetKind === "CURRENT_PENDING_ATTACK" ? effect.target.pendingAttackId : payload.pendingAttackId;
    if (!state.pendingAttack || pendingAttackId !== state.pendingAttack.pendingAttackId || state.pendingAttack.defendingPlayerId !== playerId) {
      return reject(effect, "EFFECT_PENDING_ATTACK_REQUIRED");
    }
    const effective = Math.min(payload.amount, 30 - state.pendingAttack.currentShield);
    const nextState = { ...state, pendingAttack: { ...state.pendingAttack, currentShield: state.pendingAttack.currentShield + effective } };
    return {
      state: nextState,
      result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", { requested: payload.amount, effective, before: { currentShield: state.pendingAttack.currentShield }, after: { currentShield: state.pendingAttack.currentShield + effective }, eventTypes: effective ? ["SHIELD_ADDED"] : [] }),
      events: effective ? [event(effect, "SHIELD_ADDED", { playerId, amount: effective })] : [],
    };
  }
  const currentShields = player.statusEffects.shields.filter((shield) => shield.scope === "CURRENT_PENDING_ATTACK" || (shield.expiresAfterTurnSequence ?? 0) > state.turnSequence);
  const used = currentShields.reduce((sum, shield) => sum + shield.amount, 0);
  const effective = Math.min(payload.amount, 30 - used);
  if (effective === 0) {
    return { state, result: result(effect, "NO_OP", { requested: payload.amount, effective: 0, before: { shield: used } }), events: [] };
  }
  const shield: ShieldState = {
    amount: effective,
    scope: payload.scope,
    pendingAttackId: null,
    expiresAfterTurnSequence: payload.expiresAfterTurnSequence ?? null,
  };
  const nextState = updatePlayer(state, playerId, (current) => ({ ...current, statusEffects: { ...current.statusEffects, shields: [...currentShields, shield] } }));
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: payload.amount, effective, before: { shield: used }, after: { shield: used + effective }, eventTypes: ["SHIELD_ADDED"] }),
    events: [event(effect, "SHIELD_ADDED", { playerId, amount: effective })],
  };
}

function applyReduceIncomingDamage(state: GameState, effect: EffectCommand, payload: ReduceIncomingDamagePayload) {
  if (!state.pendingAttack || effect.target.targetKind !== "CURRENT_PENDING_ATTACK" || effect.target.pendingAttackId !== state.pendingAttack.pendingAttackId) return reject(effect, "EFFECT_PENDING_ATTACK_REQUIRED");
  const playerId = state.pendingAttack.defendingPlayerId;
  const player = state.players[playerId];
  const penalty = player.statusEffects.nextDefensePenalty;
  const adjusted = Math.max(0, payload.amount - penalty);
  const effective = Math.min(adjusted, 30 - state.pendingAttack.incomingDamageReduction);
  const nextState = updatePlayer({ ...state, pendingAttack: { ...state.pendingAttack, incomingDamageReduction: state.pendingAttack.incomingDamageReduction + effective } }, playerId, (current) => ({
    ...current,
    statusEffects: { ...current.statusEffects, nextDefensePenalty: penalty > 0 ? 0 : penalty },
  }));
  return {
    state: nextState,
    result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", { requested: payload.amount, effective, before: { incomingDamageReduction: state.pendingAttack.incomingDamageReduction }, after: { incomingDamageReduction: state.pendingAttack.incomingDamageReduction + effective }, eventTypes: effective ? ["INCOMING_DAMAGE_REDUCED"] : [] }),
    events: effective ? [event(effect, "INCOMING_DAMAGE_REDUCED", { playerId, amount: effective })] : [],
  };
}

function applyDrawCard(state: GameState, effect: EffectCommand, payload: DrawCardPayload) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId) return reject(effect, "EFFECT_BAD_TARGET");
  const player = state.players[playerId];
  const count = Math.min(payload.count, state.ruleset.handLimit - player.hand.length, state.cardZones.drawPile.length);
  if (count <= 0) return { state, result: result(effect, "NO_OP", { requested: payload.count, effective: 0, before: { handCount: player.hand.length, drawPileCount: state.cardZones.drawPile.length } }), events: [] };
  const drawn = state.cardZones.drawPile.slice(0, count);
  const hand = [...player.hand, ...drawn];
  const nextCards = { ...state.cardInstances };
  for (const cardId of drawn) nextCards[cardId] = { ...nextCards[cardId], ownerPlayerId: playerId, zone: "HAND" };
  const nextState = updatePlayerAndHand({ ...state, cardZones: { ...state.cardZones, drawPile: state.cardZones.drawPile.slice(count) } }, playerId, hand, () => nextCards);
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: payload.count, effective: count, before: { handCount: player.hand.length, drawPileCount: state.cardZones.drawPile.length }, after: { handCount: hand.length, drawPileCount: state.cardZones.drawPile.length - count }, eventTypes: ["DRAW_CARD"] }),
    events: [event(effect, "DRAW_CARD", { playerId, count })],
  };
}

function applyDiscardCard(state: GameState, effect: EffectCommand, payload: DiscardCardPayload) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId) return reject(effect, "EFFECT_BAD_TARGET");
  const player = state.players[playerId];
  let cardId: string | undefined;
  if (payload.selection.selectionKind === "EXPLICIT_CARD_INSTANCE") cardId = payload.selection.cardInstanceId;
  if (payload.selection.selectionKind === "NEWEST_CARD_INSTANCE") cardId = player.hand[player.hand.length - 1];
  if (payload.selection.selectionKind === "OLDEST_CARD_INSTANCE") cardId = player.hand[0];
  if (!cardId || !player.hand.includes(cardId) || state.cardZones.inResolution.includes(cardId)) return reject(effect, "EFFECT_CONDITION_NOT_MET");
  const hand = player.hand.filter((id) => id !== cardId);
  const nextCards = { ...state.cardInstances, [cardId]: { ...state.cardInstances[cardId], zone: "DISCARD_PILE" as const } };
  const nextState = updatePlayerAndHand({ ...state, cardZones: { ...state.cardZones, discardPile: [...state.cardZones.discardPile, cardId] } }, playerId, hand, () => nextCards);
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: 1, effective: 1, before: { handCount: player.hand.length }, after: { handCount: hand.length }, eventTypes: ["CARD_DISCARDED"] }),
    events: [event(effect, "CARD_DISCARDED", { playerId, cardInstanceId: cardId })],
  };
}

function applyDamageWorld(state: GameState, effect: EffectCommand, payload: DamageWorldPayload) {
  const owner = effect.source.ownerPlayerId;
  const recordsPlayerLedger = effect.attributionPolicy === "SOURCE_OWNER" || effect.attributionPolicy === "ORIGINAL_CARD_OWNER";
  if (recordsPlayerLedger && !owner) return reject(effect, "EFFECT_BAD_SOURCE");
  const beforeDurability = state.world.durability;
  let requested = payload.amount;
  let activeField = state.activeField;
  let fieldModified = false;
  if (
    activeField
    && activeField.fieldDefinitionId === "field.frenzied-fracture.v1"
    && effect.source.sourceKind === "CARD"
    && effect.source.mode === "RELEASE"
    && effect.source.cardInstanceId
    && activeField.lastFrenziedCardInstanceId !== effect.source.cardInstanceId
  ) {
    requested += 1;
    fieldModified = true;
    activeField = { ...activeField, lastFrenziedCardInstanceId: effect.source.cardInstanceId };
  }
  if (
    activeField
    && activeField.fieldDefinitionId === "field.root-sanctuary.v1"
    && activeField.rootSanctuaryUsedTurnSequence !== state.turnSequence
  ) {
    requested = Math.max(0, requested - 2);
    fieldModified = true;
    activeField = { ...activeField, rootSanctuaryUsedTurnSequence: state.turnSequence };
  }
  const effective = Math.min(requested, beforeDurability);
  const afterDurability = beforeDurability - effective;
  const triggered = [...state.world.triggeredThresholds];
  for (const threshold of state.ruleset.worldThresholds) {
    if (beforeDurability > threshold && afterDurability <= threshold && !triggered.includes(threshold)) triggered.push(threshold);
  }
  const worldState: GameState = {
    ...state,
    activeField,
    world: {
      ...state.world,
      durability: afterDurability,
      triggeredThresholds: triggered,
      collapseResponsiblePlayerId: afterDurability === 0 && beforeDurability > 0 && recordsPlayerLedger ? owner : state.world.collapseResponsiblePlayerId,
    },
  };
  const nextState = recordsPlayerLedger && owner
    ? updatePlayer(worldState, owner, (player) => ({ ...player, worldDamageResponsibility: player.worldDamageResponsibility + effective }))
    : worldState;
  const eventTypes = ["DAMAGE_WORLD_APPLIED", ...(fieldModified ? ["FIELD_EFFECT_APPLIED"] : []), ...triggered.filter((threshold) => !state.world.triggeredThresholds.includes(threshold)).map(() => "WORLD_THRESHOLD_TRIGGERED")];
  return {
    state: nextState,
    result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", { requested, effective, before: { worldDurability: beforeDurability }, after: { worldDurability: afterDurability }, ledgerDelta: recordsPlayerLedger && owner ? { ledgerKind: "WORLD_DAMAGE_RESPONSIBILITY", playerId: owner, amount: effective } : undefined, eventTypes }),
    events: [event(effect, "DAMAGE_WORLD_APPLIED", { ownerPlayerId: owner, requested, effective }), ...(fieldModified ? [event(effect, "FIELD_EFFECT_APPLIED", { requested, effective })] : []), ...triggered.filter((threshold) => !state.world.triggeredThresholds.includes(threshold)).map((threshold) => event(effect, "WORLD_THRESHOLD_TRIGGERED", { threshold }))],
  };
}

function applyRestoreWorld(state: GameState, effect: EffectCommand, payload: RestoreWorldPayload) {
  const owner = effect.source.ownerPlayerId;
  const recordsPlayerLedger = effect.attributionPolicy === "SOURCE_OWNER" || effect.attributionPolicy === "ORIGINAL_CARD_OWNER";
  if (recordsPlayerLedger && !owner) return reject(effect, "EFFECT_BAD_SOURCE");
  const beforeDurability = state.world.durability;
  const effective = Math.min(payload.amount, state.world.maxDurability - beforeDurability);
  const worldState: GameState = { ...state, world: { ...state.world, durability: beforeDurability + effective } };
  const nextState = recordsPlayerLedger && owner
    ? updatePlayer(worldState, owner, (player) => ({ ...player, effectiveWorldRestore: player.effectiveWorldRestore + effective }))
    : worldState;
  return {
    state: nextState,
    result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", { requested: payload.amount, effective, before: { worldDurability: beforeDurability }, after: { worldDurability: beforeDurability + effective }, ledgerDelta: recordsPlayerLedger && owner ? { ledgerKind: "EFFECTIVE_WORLD_RESTORE", playerId: owner, amount: effective } : undefined, eventTypes: effective ? ["RESTORE_WORLD_APPLIED"] : [] }),
    events: effective ? [event(effect, "RESTORE_WORLD_APPLIED", { ownerPlayerId: owner, requested: payload.amount, effective })] : [],
  };
}

function applySetField(state: GameState, effect: EffectCommand, payload: SetFieldPayload) {
  if (payload.expiresAfterTurnSequence <= state.turnSequence || payload.ownerPlayerId !== effect.source.ownerPlayerId) return reject(effect, "EFFECT_CONDITION_NOT_MET");
  const nextState = { ...state, activeField: { fieldDefinitionId: payload.fieldDefinitionId, ownerPlayerId: payload.ownerPlayerId, expiresAfterTurnSequence: payload.expiresAfterTurnSequence, lastFrenziedCardInstanceId: null, rootSanctuaryUsedTurnSequence: null } };
  const eventTypes = state.activeField ? ["FIELD_CLEARED", "FIELD_SET"] : ["FIELD_SET"];
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: 1, effective: 1, before: { fieldDefinitionId: state.activeField?.fieldDefinitionId ?? null }, after: { fieldDefinitionId: payload.fieldDefinitionId }, eventTypes }),
    events: eventTypes.map((type) => event(effect, type, { fieldDefinitionId: payload.fieldDefinitionId })),
  };
}

function applyClearField(state: GameState, effect: EffectCommand) {
  if (!state.activeField) return reject(effect, "EFFECT_NO_ACTIVE_FIELD");
  const fieldDefinitionId = state.activeField.fieldDefinitionId;
  const nextState = { ...state, activeField: null };
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: 1, effective: 1, before: { fieldDefinitionId }, after: { fieldDefinitionId: null }, eventTypes: ["FIELD_CLEARED"] }),
    events: [event(effect, "FIELD_CLEARED", { fieldDefinitionId })],
  };
}

function applyModifyStat(state: GameState, effect: EffectCommand, payload: ModifyStatUntilTurnEndPayload) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId || payload.expiresAfterTurnSequence <= state.turnSequence || payload.delta === 0) return reject(effect, "EFFECT_CONDITION_NOT_MET");
  const modifier: StatModifierState = { stat: payload.stat, delta: payload.delta, expiresAfterTurnSequence: payload.expiresAfterTurnSequence };
  const nextState = updatePlayer(state, playerId, (player) => ({ ...player, statusEffects: { ...player.statusEffects, statModifiers: [...player.statusEffects.statModifiers, modifier] } }));
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: 1, effective: 1, before: {}, after: { delta: payload.delta }, eventTypes: ["STAT_MODIFIED"] }),
    events: [event(effect, "STAT_MODIFIED", { playerId, delta: payload.delta })],
  };
}

function applyModifyNextAction(state: GameState, effect: EffectCommand, payload: ModifyNextActionPayload) {
  const playerId = targetPlayerId(effect.target);
  if (!playerId || payload.delta === 0) return reject(effect, "EFFECT_CONDITION_NOT_MET");
  if ((payload.stat === "DEFENSE_VALUE" || payload.stat === "INCOMING_DAMAGE_REDUCTION") && payload.consumeWhen === "NEXT_DEFENSE_CARD" && payload.delta < 0) {
    const penalty = Math.max(state.players[playerId].statusEffects.nextDefensePenalty, Math.abs(payload.delta));
    const nextState = updatePlayer(state, playerId, (player) => ({ ...player, statusEffects: { ...player.statusEffects, nextDefensePenalty: penalty } }));
    return {
      state: nextState,
      result: result(effect, "APPLIED", { requested: 1, effective: 1, before: { nextDefensePenalty: state.players[playerId].statusEffects.nextDefensePenalty }, after: { nextDefensePenalty: penalty }, eventTypes: ["NEXT_ACTION_MODIFIED"] }),
      events: [event(effect, "NEXT_ACTION_MODIFIED", { playerId, penalty })],
    };
  }
  const modifier: StatModifierState = { stat: payload.stat === "ACTION_DAMAGE" ? "ACTION_DAMAGE" : "INCOMING_DAMAGE_REDUCTION", delta: payload.delta, expiresAfterTurnSequence: state.turnSequence + 1 };
  const nextState = updatePlayer(state, playerId, (player) => ({ ...player, statusEffects: { ...player.statusEffects, statModifiers: [...player.statusEffects.statModifiers, modifier] } }));
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: 1, effective: 1, before: {}, after: { delta: payload.delta }, eventTypes: ["NEXT_ACTION_MODIFIED"] }),
    events: [event(effect, "NEXT_ACTION_MODIFIED", { playerId, delta: payload.delta })],
  };
}

function applyScoreModifier(state: GameState, effect: EffectCommand, payload: AddScoreModifierPayload) {
  const modifier: ScoreModifierState = { playerId: payload.playerId, modifierKind: payload.modifierKind, amount: payload.amount };
  const nextState = { ...state, scoreModifiers: [...state.scoreModifiers, modifier] };
  return {
    state: nextState,
    result: result(effect, "APPLIED", { requested: payload.amount, effective: payload.amount, before: {}, after: { amount: payload.amount }, eventTypes: ["SCORE_MODIFIER_ADDED"] }),
    events: [event(effect, "SCORE_MODIFIER_ADDED", { playerId: payload.playerId, amount: payload.amount })],
  };
}

export function beginPendingAttack(state: GameState, pending: Omit<PendingAttackState, "responseCount" | "incomingDamageReduction" | "currentShield" | "effectiveDamage" | "reflectionApplied">): GameState {
  if (state.phase !== "RESOLUTION" && state.phase !== "RESPONSE_SELECTION") throw new Error("pending attack must be opened during resolution");
  const nextState = {
    ...state,
    pendingAttack: {
      ...pending,
      responseCount: 0,
      incomingDamageReduction: 0,
      currentShield: 0,
      effectiveDamage: null,
      reflectionApplied: false,
    },
  };
  assertGameState(nextState);
  return nextState;
}

export function applyEffect(state: GameState, input: unknown, usedEffectIds: ReadonlySet<string> = new Set()) {
  const validation = validateEffectCommand(state, input);
  if (!validation.ok) {
    const effect = (isRecord(input) ? input : { effectId: "effect.invalid.0000", commandType: "DAMAGE_PLAYER" }) as unknown as EffectCommand;
    return { state, result: result(effect, "REJECTED", { rejectionCode: validation.code }), events: [] as EffectEvent[] };
  }
  const effect = validation.effect;
  if (usedEffectIds.has(effect.effectId)) return { state, result: result(effect, "REJECTED", { rejectionCode: "EFFECT_DUPLICATE_ID" }), events: [] as EffectEvent[] };
  let transition: { state: GameState | null; result: EffectExecutionResult; events: EffectEvent[] };
  switch (effect.commandType) {
    case "DAMAGE_PLAYER": transition = applyDamage(state, effect, effect.payload as DamagePlayerPayload, effect.payload.damageKind === "REFLECTION"); break;
    case "HEAL_PLAYER": {
      const playerId = targetPlayerId(effect.target); const payload = effect.payload as HealPlayerPayload;
      if (!playerId || state.players[playerId].hitPoints <= 0) transition = reject(effect, "EFFECT_REVIVE_FORBIDDEN");
      else { const player = state.players[playerId]; const effective = Math.min(payload.amount, player.maxHitPoints - player.hitPoints); const nextState = updatePlayer(state, playerId, (current) => ({ ...current, hitPoints: current.hitPoints + effective })); transition = { state: nextState, result: result(effect, effective === 0 ? "NO_OP" : "APPLIED", { requested: payload.amount, effective, before: { hitPoints: player.hitPoints }, after: { hitPoints: player.hitPoints + effective }, eventTypes: effective ? ["HEAL_PLAYER_APPLIED"] : [] }), events: effective ? [event(effect, "HEAL_PLAYER_APPLIED", { playerId, amount: effective })] : [] }; }
      break;
    }
    case "PAY_HP": transition = applyPayHp(state, effect, effect.payload as PayHpPayload); break;
    case "ADD_SHIELD": transition = applyAddShield(state, effect, effect.payload as AddShieldPayload); break;
    case "REDUCE_INCOMING_DAMAGE": transition = applyReduceIncomingDamage(state, effect, effect.payload as ReduceIncomingDamagePayload); break;
    case "REFLECT_DAMAGE": {
      const payload = effect.payload as ReflectDamagePayload;
      if (!state.pendingAttack || state.pendingAttack.pendingAttackId !== payload.pendingAttackId || state.pendingAttack.reflectionApplied || effect.target.targetKind !== "PLAYER" || effect.target.playerId !== state.pendingAttack.attackingPlayerId) transition = reject(effect, "EFFECT_CONDITION_NOT_MET");
      else {
        const amount = Math.min(payload.amount, state.pendingAttack.effectiveDamage ?? state.pendingAttack.baseDamage);
        const reflected = applyDamage(state, { ...effect, payload: { amount, damageKind: "REFLECTION" } as DamagePlayerPayload, executionTiming: "IMMEDIATE" }, { amount, damageKind: "REFLECTION" }, true);
        if (!reflected.state) transition = reflected;
        else { transition = { ...reflected, state: { ...reflected.state, pendingAttack: { ...state.pendingAttack, reflectionApplied: true } }, result: { ...reflected.result, commandType: "REFLECT_DAMAGE", eventTypes: ["REFLECT_DAMAGE_APPLIED", ...reflected.result.eventTypes] }, events: [event(effect, "REFLECT_DAMAGE_APPLIED", { playerId: effect.target.playerId, amount }), ...reflected.events] }; }
      }
      break;
    }
    case "DRAW_CARD": transition = applyDrawCard(state, effect, effect.payload as DrawCardPayload); break;
    case "DISCARD_CARD": transition = applyDiscardCard(state, effect, effect.payload as DiscardCardPayload); break;
    case "DAMAGE_WORLD": transition = applyDamageWorld(state, effect, effect.payload as DamageWorldPayload); break;
    case "RESTORE_WORLD": transition = applyRestoreWorld(state, effect, effect.payload as RestoreWorldPayload); break;
    case "SET_FIELD": transition = applySetField(state, effect, effect.payload as SetFieldPayload); break;
    case "CLEAR_FIELD": transition = applyClearField(state, effect); break;
    case "MODIFY_STAT_UNTIL_TURN_END": transition = applyModifyStat(state, effect, effect.payload as ModifyStatUntilTurnEndPayload); break;
    case "MODIFY_NEXT_ACTION": transition = applyModifyNextAction(state, effect, effect.payload as ModifyNextActionPayload); break;
    case "REVEAL_PUBLIC_INFORMATION": transition = { state, result: result(effect, "APPLIED", { requested: 1, effective: 1, eventTypes: ["PUBLIC_INFORMATION_REVEALED"] }), events: [event(effect, "PUBLIC_INFORMATION_REVEALED", {})] }; break;
    case "ADD_SCORE_MODIFIER": transition = applyScoreModifier(state, effect, effect.payload as AddScoreModifierPayload); break;
  }
  if (transition.state && (transition.result.status === "APPLIED" || transition.result.status === "NO_OP")) assertGameState(transition.state);
  return transition.state ? transition : { ...transition, state };
}

function invalidMatchState(state: GameState): GameState {
  return {
    ...state,
    phase: "FINISHED",
    activePlayerId: null,
    respondingPlayerId: null,
    effectQueue: [],
    pendingAction: null,
    pendingAttack: null,
    terminalFlags: { ...state.terminalFlags, endKind: "INVALID_MATCH", battleWinnerId: null, divineSelectionWinnerId: null },
    judgment: null,
  };
}

function nextGeneratedEffectId(usedIds: ReadonlySet<string>, prefix: string): string {
  for (let ordinal = 1; ordinal <= 9999; ordinal += 1) {
    const effectId = `effect.${prefix}.${String(ordinal).padStart(4, "0")}`;
    if (!usedIds.has(effectId)) return effectId;
  }
  throw new Error("generated effect id space exhausted");
}

function worldLawSource(state: GameState) {
  return {
    sourceKind: "WORLD_LAW" as const,
    ownerPlayerId: null,
    worldLawId: state.world.worldLawId,
    mode: "SYSTEM" as const,
  };
}

function worldLawRevealEffect(state: GameState, effectId: string, threshold: number): EffectCommand {
  return {
    effectId,
    commandType: "REVEAL_PUBLIC_INFORMATION",
    source: worldLawSource(state),
    target: { targetKind: "PUBLIC_INFORMATION" },
    payload: { informationKind: "WORLD_THRESHOLD", threshold },
    attributionPolicy: "NO_LEDGER",
    executionTiming: "WORLD_LAW_PHASE",
  };
}

function annotateWorldLawTransition(
  transition: { state: GameState; result: EffectExecutionResult; events: EffectEvent[] },
  effect: EffectCommand,
  details: Record<string, Scalar>,
) {
  const retainedEventTypes = transition.result.eventTypes.filter((type) => (
    type !== "PUBLIC_INFORMATION_REVEALED"
    && type !== "NEXT_ACTION_MODIFIED"
    && type !== "WORLD_LAW_EFFECT_APPLIED"
  ));
  const retainedEvents = transition.events.filter((currentEvent) => (
    currentEvent.type !== "PUBLIC_INFORMATION_REVEALED"
    && currentEvent.type !== "NEXT_ACTION_MODIFIED"
    && currentEvent.type !== "WORLD_LAW_EFFECT_APPLIED"
  ));
  const lawEvent = event(effect, "WORLD_LAW_EFFECT_APPLIED", details);
  return {
    state: transition.state,
    result: { ...transition.result, eventTypes: ["WORLD_LAW_EFFECT_APPLIED", ...retainedEventTypes] },
    events: [lawEvent, ...retainedEvents],
  };
}

function activateFragileWorld(state: GameState): GameState {
  const players = Object.fromEntries(Object.entries(state.players).map(([playerId, player]) => [
    playerId,
    { ...player, statusEffects: { ...player.statusEffects, fragileWorld: true } },
  ]));
  return { ...state, players };
}

export function resolveEffectQueue(state: GameState, effects: readonly EffectCommand[]): EffectQueueResult {
  if (effects.length > state.ruleset.maxEffectsPerResolution) {
    return { committed: false, state: invalidMatchState(state), results: [], events: [], rejectionCode: "EFFECT_QUEUE_LIMIT" };
  }
  let working: GameState = { ...state, effectQueue: [...effects] };
  const results: EffectExecutionResult[] = [];
  const events: EffectEvent[] = [];
  const usedIds = new Set<string>();
  const queue = [...effects];
  const reservedEffectIds = new Set(effects.map((effect) => effect.effectId));
  const generatedEffectId = (prefix: string): string => {
    const effectId = nextGeneratedEffectId(new Set([...usedIds, ...reservedEffectIds]), prefix);
    reservedEffectIds.add(effectId);
    return effectId;
  };
  let effectBudgetUsed = effects.length;
  const newlyTriggeredThresholds = new Set<number>();
  const cardsCrossing25 = new Set<string>();
  const fragileDamageCards = new Set<string>();
  let pendingFragileSelfDamage: { readonly cardInstanceId: string; readonly effect: EffectCommand } | null = null;
  let lastEffectiveRestorePlayerId: PlayerId | null = null;

  let index = 0;
  while (index < queue.length || pendingFragileSelfDamage) {
    if (pendingFragileSelfDamage) {
      const nextEffect = queue[index];
      const nextCardInstanceId = nextEffect?.source.sourceKind === "CARD"
        ? nextEffect.source.cardInstanceId
        : undefined;
      if (!nextEffect || nextCardInstanceId !== pendingFragileSelfDamage.cardInstanceId) {
        queue.splice(index, 0, pendingFragileSelfDamage.effect);
        pendingFragileSelfDamage = null;
        continue;
      }
    }
    const currentEffect = queue[index];
    const beforeThresholds = new Set(working.world.triggeredThresholds);
    const before25Triggered = working.world.triggeredThresholds.includes(25);
    const transition = applyEffect(working, currentEffect, usedIds);
    if (transition.result.status === "REJECTED" || transition.result.status === "INVALID_MATCH") {
      return { committed: false, state, results: [...results, transition.result], events: [], rejectionCode: transition.result.rejectionCode };
    }
    if (transition.result.eventTypes.includes("FIELD_EFFECT_APPLIED")) {
      effectBudgetUsed += 1;
      if (effectBudgetUsed > state.ruleset.maxEffectsPerResolution) {
        return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: "EFFECT_QUEUE_LIMIT" };
      }
    }
    for (const threshold of transition.state.world.triggeredThresholds) {
      if (!beforeThresholds.has(threshold)) newlyTriggeredThresholds.add(threshold);
    }
    if (
      currentEffect.commandType === "RESTORE_WORLD"
      && transition.result.ledgerDelta?.ledgerKind === "EFFECTIVE_WORLD_RESTORE"
      && transition.result.ledgerDelta.amount > 0
    ) {
      lastEffectiveRestorePlayerId = transition.result.ledgerDelta.playerId;
    }

    let spawnedEffectIds: readonly string[] = [];
    if (currentEffect.commandType === "DAMAGE_WORLD") {
      const source = currentEffect.source;
      const cardInstanceId = source.cardInstanceId;
      const effective = transition.result.effective ?? 0;
      if (
        source.sourceKind === "CARD"
        && (source.mode === "RELEASE" || source.mode === "RESPONSE")
        && cardInstanceId
        && effective > 0
      ) {
        const after25Triggered = transition.state.world.triggeredThresholds.includes(25);
        if (!before25Triggered && after25Triggered) {
          cardsCrossing25.add(cardInstanceId);
        } else if (
          before25Triggered
          && !cardsCrossing25.has(cardInstanceId)
          && !fragileDamageCards.has(cardInstanceId)
          && source.ownerPlayerId
          && working.world.triggeredThresholds.includes(25)
          && !newlyTriggeredThresholds.has(25)
        ) {
          const fragileEffect: EffectCommand = {
            effectId: generatedEffectId("fragile-world"),
            commandType: "DAMAGE_PLAYER",
            source: worldLawSource(working),
            target: { targetKind: "PLAYER", playerId: source.ownerPlayerId },
            payload: { amount: 2, damageKind: "FRAGILE_WORLD" },
            attributionPolicy: "NO_LEDGER",
            executionTiming: "IMMEDIATE",
          };
          effectBudgetUsed += 1;
          if (effectBudgetUsed > state.ruleset.maxEffectsPerResolution) {
            return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: "EFFECT_QUEUE_LIMIT" };
          }
          pendingFragileSelfDamage = { cardInstanceId, effect: fragileEffect };
          spawnedEffectIds = [fragileEffect.effectId];
          fragileDamageCards.add(cardInstanceId);
        }
      }
    }

    usedIds.add(currentEffect.effectId);
    working = { ...transition.state, effectQueue: queue.slice(index + 1) };
    results.push({ ...transition.result, spawnedEffectIds });
    events.push(...transition.events);
    index += 1;
  }

  const applyGenerated = (
    generatedEffect: EffectCommand,
    details: Record<string, Scalar> | ((generatedResult: EffectExecutionResult) => Record<string, Scalar>),
    stateTransform: (currentState: GameState) => GameState = (currentState) => currentState,
  ): { ok: true } | { ok: false; rejectionCode: EffectRejectionCode } => {
    if (effectBudgetUsed >= state.ruleset.maxEffectsPerResolution) return { ok: false, rejectionCode: "EFFECT_QUEUE_LIMIT" };
    effectBudgetUsed += 1;
    const generatedTransition = applyEffect(working, generatedEffect, usedIds);
    if (generatedTransition.result.status === "REJECTED" || generatedTransition.result.status === "INVALID_MATCH") {
      return { ok: false, rejectionCode: generatedTransition.result.rejectionCode ?? "EFFECT_STATE_INCONSISTENT" };
    }
    const resolvedDetails = typeof details === "function" ? details(generatedTransition.result) : details;
    const decorated = annotateWorldLawTransition(generatedTransition, generatedEffect, resolvedDetails);
    usedIds.add(generatedEffect.effectId);
    working = { ...stateTransform(decorated.state), effectQueue: [] };
    results.push(decorated.result);
    events.push(...decorated.events);
    return { ok: true };
  };

  for (const threshold of state.ruleset.worldThresholds) {
    if (!newlyTriggeredThresholds.has(threshold)) continue;
    if (threshold === 75) {
      const responsibilities = state.initialPlayerOrder.map((playerId) => working.players[playerId].worldDamageResponsibility);
      const highest = Math.max(...responsibilities);
      const targets = highest > 0
        ? state.initialPlayerOrder.filter((playerId) => working.players[playerId].worldDamageResponsibility === highest)
        : [];
      const penalty = targets.length === 1 ? 2 : targets.length > 1 ? 1 : 0;
      if (targets.length === 0) {
        const generated = worldLawRevealEffect(working, generatedEffectId("world-law"), 75);
        const applied = applyGenerated(generated, { threshold: 75, targetPlayerId: null, penalty: 0 });
        if (!applied.ok) return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: applied.rejectionCode };
      } else {
        for (const playerId of targets) {
          const generated: EffectCommand = {
            effectId: generatedEffectId("world-law"),
            commandType: "MODIFY_NEXT_ACTION",
            source: worldLawSource(working),
            target: { targetKind: "PLAYER", playerId },
            payload: { stat: "INCOMING_DAMAGE_REDUCTION", delta: -penalty, consumeWhen: "NEXT_DEFENSE_CARD" },
            attributionPolicy: "NO_LEDGER",
            executionTiming: "WORLD_LAW_PHASE",
          };
          const applied = applyGenerated(generated, { threshold: 75, targetPlayerId: playerId, penalty });
          if (!applied.ok) return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: applied.rejectionCode };
        }
      }
    }

    if (threshold === 50) {
      if (lastEffectiveRestorePlayerId) {
        const generated: EffectCommand = {
          effectId: generatedEffectId("world-law"),
          commandType: "DRAW_CARD",
          source: worldLawSource(working),
          target: { targetKind: "PLAYER", playerId: lastEffectiveRestorePlayerId },
          payload: { count: 1, reason: "WORLD_LAW_50" },
          attributionPolicy: "NO_LEDGER",
          executionTiming: "WORLD_LAW_PHASE",
        };
        const applied = applyGenerated(generated, (generatedResult) => ({
          threshold: 50,
          targetPlayerId: lastEffectiveRestorePlayerId,
          draw: generatedResult.effective ?? 0,
        }));
        if (!applied.ok) return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: applied.rejectionCode };
      } else {
        const generated = worldLawRevealEffect(working, generatedEffectId("world-law"), 50);
        const applied = applyGenerated(generated, { threshold: 50, targetPlayerId: null, draw: 0 });
        if (!applied.ok) return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: applied.rejectionCode };
      }
    }

    if (threshold === 25) {
      const generated = worldLawRevealEffect(working, generatedEffectId("world-law"), 25);
      const applied = applyGenerated(generated, { threshold: 25, targetPlayerId: null }, activateFragileWorld);
      if (!applied.ok) return { committed: false, state: invalidMatchState(state), results, events: [], rejectionCode: applied.rejectionCode };
    }
  }

  const beforeTerminal = working;
  working = finalizeTerminalState(working);
  if (working !== beforeTerminal) {
    const terminalEffect: EffectCommand = {
      effectId: "effect.terminal.0001",
      commandType: "REVEAL_PUBLIC_INFORMATION",
      source: { sourceKind: "SYSTEM", ownerPlayerId: null, mode: "SYSTEM" },
      target: { targetKind: "PUBLIC_INFORMATION" },
      payload: { informationKind: "MATCH_FINISHED" },
      attributionPolicy: "NO_LEDGER",
      executionTiming: "TERMINAL_PHASE",
    };
    if (!beforeTerminal.terminalFlags.worldCollapsed && working.terminalFlags.worldCollapsed) {
      events.push(event(terminalEffect, "WORLD_COLLAPSED", { worldDurability: 0 }));
    }
    if (working.judgment) events.push(event(terminalEffect, "JUDGMENT_COMPUTED", { winnerId: working.judgment.winnerId }));
    events.push(event(terminalEffect, "MATCH_FINISHED", { endKind: working.terminalFlags.endKind }));
  }
  working = { ...working, effectQueue: [] };
  assertGameState(working);
  return { committed: true, state: working, results, events };
}
