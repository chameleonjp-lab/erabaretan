const actionTargetCondition = {
    phase: "ACTION_SELECTION",
    requiresOpponentTarget: true,
};
const actionCondition = { phase: "ACTION_SELECTION" };
const responseCondition = {
    phase: "RESPONSE_SELECTION",
    requiresPendingAttackDefender: true,
};
const damagePlayer = (amount, target) => ({
    commandType: "DAMAGE_PLAYER",
    target,
    payload: { amount, damageKind: "DIRECT" },
    attributionPolicy: "NO_LEDGER",
    executionTiming: "AFTER_RESPONSE_MODIFIERS",
});
const damageWorld = (amount) => ({
    commandType: "DAMAGE_WORLD",
    target: "WORLD",
    payload: { amount, reason: "CARD_RELEASE" },
    attributionPolicy: "SOURCE_OWNER",
    executionTiming: "IMMEDIATE",
});
const nextApplicableShield = (amount) => ({
    commandType: "ADD_SHIELD",
    target: "SELF",
    payload: { amount, scope: "NEXT_APPLICABLE_ATTACK" },
    attributionPolicy: "NO_LEDGER",
    executionTiming: "IMMEDIATE",
});
export const INITIAL_12_CARD_DEFINITIONS = [
    {
        cardDefinitionId: "attack.steadfast-strike.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "堅実な一撃",
        role: "ATTACK",
        worldImpactType: "NEUTRAL",
        copiesInDeck: 3,
        modes: { RELEASE: [damagePlayer(6, "OPPONENT")] },
        conditions: { RELEASE: actionTargetCondition },
    },
    {
        cardDefinitionId: "attack.star-breaker.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "星砕き",
        role: "ATTACK",
        worldImpactType: "DAMAGE",
        copiesInDeck: 3,
        modes: {
            RELEASE: [damagePlayer(16, "OPPONENT"), damageWorld(7)],
            RESTRAIN: [nextApplicableShield(3)],
        },
        conditions: { RELEASE: actionTargetCondition, RESTRAIN: actionCondition },
    },
    {
        cardDefinitionId: "attack.rift-pebble.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "裂け目の礫",
        role: "ATTACK",
        worldImpactType: "DAMAGE",
        copiesInDeck: 3,
        modes: {
            RELEASE: [damagePlayer(4, "OPPONENT"), damageWorld(2)],
            RESTRAIN: [nextApplicableShield(1)],
        },
        conditions: { RELEASE: actionTargetCondition, RESTRAIN: actionCondition },
    },
    {
        cardDefinitionId: "defense.guardian-veil.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "守りの帳",
        role: "DEFENSE",
        worldImpactType: "NEUTRAL",
        copiesInDeck: 3,
        modes: { RESPONSE: [{ commandType: "ADD_SHIELD", target: "CURRENT_PENDING_ATTACK", payload: { amount: 7, scope: "CURRENT_PENDING_ATTACK" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
        conditions: { RESPONSE: responseCondition },
    },
    {
        cardDefinitionId: "defense.ashen-bulwark.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "灰燼の城壁",
        role: "DEFENSE",
        worldImpactType: "DAMAGE",
        copiesInDeck: 3,
        modes: { RESPONSE: [{ commandType: "ADD_SHIELD", target: "CURRENT_PENDING_ATTACK", payload: { amount: 12, scope: "CURRENT_PENDING_ATTACK" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { ...damageWorld(4), payload: { amount: 4, reason: "CARD_RESPONSE" } }] },
        conditions: { RESPONSE: responseCondition },
    },
    {
        cardDefinitionId: "intervention.verdant-bargain.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "緑の取引",
        role: "INTERVENTION",
        worldImpactType: "RESTORE",
        copiesInDeck: 3,
        modes: { RESPONSE: [{ commandType: "REDUCE_INCOMING_DAMAGE", target: "CURRENT_PENDING_ATTACK", payload: { amount: 3 }, attributionPolicy: "NO_LEDGER", executionTiming: "AFTER_RESPONSE_MODIFIERS" }, { commandType: "RESTORE_WORLD", target: "WORLD", payload: { amount: 4, reason: "CARD_RESPONSE" }, attributionPolicy: "SOURCE_OWNER", executionTiming: "IMMEDIATE" }] },
        conditions: { RESPONSE: responseCondition },
    },
    {
        cardDefinitionId: "intervention.oath-of-renewal.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "再生の誓約",
        role: "INTERVENTION",
        worldImpactType: "RESTORE",
        copiesInDeck: 3,
        modes: { RELEASE: [{ commandType: "PAY_HP", target: "SELF", payload: { amount: 4, minimumRemainingHp: 1 }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { commandType: "RESTORE_WORLD", target: "WORLD", payload: { amount: 7, reason: "CARD_RELEASE" }, attributionPolicy: "SOURCE_OWNER", executionTiming: "IMMEDIATE" }] },
        conditions: { RELEASE: { ...actionCondition, selfHitPointsAtLeast: 5, worldBelowMax: true } },
    },
    {
        cardDefinitionId: "intervention.judgment-of-scars.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "傷痕への審罰",
        role: "INTERVENTION",
        worldImpactType: "NEUTRAL",
        copiesInDeck: 3,
        modes: { RELEASE: [damagePlayer(8, "OPPONENT")], RESTRAIN: [damagePlayer(3, "OPPONENT")] },
        conditions: { RELEASE: { ...actionTargetCondition, opponentWorldDamageResponsibilityAtLeast: 5 }, RESTRAIN: actionTargetCondition },
    },
    {
        cardDefinitionId: "field.frenzied-fracture.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "狂奔する亀裂",
        role: "FIELD",
        worldImpactType: "DAMAGE",
        copiesInDeck: 3,
        modes: { RELEASE: [{ commandType: "SET_FIELD", target: "CURRENT_FIELD", payload: { fieldDefinitionId: "field.frenzied-fracture.v1" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
        conditions: { RELEASE: actionCondition },
    },
    {
        cardDefinitionId: "field.root-sanctuary.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "根守りの結界",
        role: "FIELD",
        worldImpactType: "NEUTRAL",
        copiesInDeck: 3,
        modes: { RELEASE: [{ commandType: "SET_FIELD", target: "CURRENT_FIELD", payload: { fieldDefinitionId: "field.root-sanctuary.v1" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
        conditions: { RELEASE: actionCondition },
    },
    {
        cardDefinitionId: "intervention.field-nullification.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "無色の宣告",
        role: "INTERVENTION",
        worldImpactType: "DAMAGE",
        copiesInDeck: 3,
        modes: { RELEASE: [{ commandType: "CLEAR_FIELD", target: "CURRENT_FIELD", payload: { reason: "CARD_RELEASE" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, damageWorld(2)] },
        conditions: { RELEASE: { ...actionCondition, activeFieldRequired: true } },
    },
    {
        cardDefinitionId: "intervention.careful-redraw.v1",
        cardVersion: 1,
        introducedRulesetId: "ruleset.alpha-12.v1",
        displayName: "静かな手直し",
        role: "INTERVENTION",
        worldImpactType: "NEUTRAL",
        copiesInDeck: 3,
        modes: { RELEASE: [{ commandType: "DISCARD_CARD", target: "SELF", payload: { selection: { selectionKind: "NEWEST_CARD_INSTANCE" }, reason: "CARD_EFFECT" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }, { commandType: "DRAW_CARD", target: "SELF", payload: { count: 1, reason: "CARD_EFFECT" }, attributionPolicy: "NO_LEDGER", executionTiming: "IMMEDIATE" }] },
        conditions: { RELEASE: { ...actionCondition, handSizeAtLeast: 2 } },
    },
];
export const INITIAL_12_CARD_BY_ID = Object.fromEntries(INITIAL_12_CARD_DEFINITIONS.map((definition) => [definition.cardDefinitionId, definition]));
function resolveTarget(target, input) {
    if (target === "SELF")
        return { targetKind: "PLAYER", playerId: input.ownerPlayerId };
    if (target === "OPPONENT") {
        if (!input.targetPlayerId)
            throw new Error("targetPlayerId is required for an opponent effect");
        return { targetKind: "PLAYER", playerId: input.targetPlayerId };
    }
    if (target === "WORLD")
        return { targetKind: "WORLD" };
    if (target === "CURRENT_FIELD")
        return { targetKind: "CURRENT_FIELD" };
    if (!input.pendingAttackId)
        throw new Error("pendingAttackId is required for a response effect");
    return { targetKind: "CURRENT_PENDING_ATTACK", pendingAttackId: input.pendingAttackId };
}
export function buildInitial12CardEffects(input) {
    const definition = INITIAL_12_CARD_BY_ID[input.cardDefinitionId];
    if (!definition)
        throw new Error(`Unknown initial card definition: ${input.cardDefinitionId}`);
    const templates = definition.modes[input.mode];
    if (!templates)
        throw new Error(`${input.cardDefinitionId} does not support mode ${input.mode}`);
    return templates.map((template, index) => {
        const payload = { ...template.payload };
        if (template.commandType === "DISCARD_CARD") {
            if (!input.discardCardInstanceId) {
                throw new Error("discardCardInstanceId is required for careful-redraw");
            }
            if (input.discardCardInstanceId === input.cardInstanceId)
                throw new Error("discardCardInstanceId must differ from the card being resolved");
            payload.selection = {
                selectionKind: "EXPLICIT_CARD_INSTANCE",
                cardInstanceId: input.discardCardInstanceId,
            };
        }
        if (template.commandType === "ADD_SHIELD" && payload.scope === "CURRENT_PENDING_ATTACK")
            payload.pendingAttackId = input.pendingAttackId;
        if (template.commandType === "ADD_SHIELD" && payload.scope === "NEXT_APPLICABLE_ATTACK")
            payload.expiresAfterTurnSequence = input.turnSequence + 2;
        if (template.commandType === "SET_FIELD") {
            payload.ownerPlayerId = input.ownerPlayerId;
            payload.expiresAfterTurnSequence = input.turnSequence + 3;
        }
        return {
            effectId: `effect.${input.resolutionId}.${String(index + 1).padStart(4, "0")}`,
            commandType: template.commandType,
            source: {
                sourceKind: "CARD",
                ownerPlayerId: input.ownerPlayerId,
                cardDefinitionId: input.cardDefinitionId,
                cardInstanceId: input.cardInstanceId,
                mode: input.mode,
            },
            target: resolveTarget(template.target, input),
            payload: payload,
            attributionPolicy: template.attributionPolicy,
            executionTiming: template.executionTiming,
        };
    });
}
/**
 * Validates the alpha-12 catalog conditions without putting card-specific
 * knowledge into game-core. The command layer can call this after the generic
 * command shape/ownership checks have passed.
 */
export function validateInitial12CardPlay(input) {
    const card = input.state.cardInstances[input.cardInstanceId];
    if (!card)
        return { ok: false, code: "INVALID_CARD", message: "card instance does not exist" };
    if (card.ownerPlayerId !== input.playerId || !input.state.cardZones.hands[input.playerId]?.includes(input.cardInstanceId)) {
        return { ok: false, code: "CARD_NOT_IN_HAND", message: "card instance is not in the player's hand" };
    }
    const definition = INITIAL_12_CARD_BY_ID[card.cardDefinitionId];
    if (!definition)
        return { ok: false, code: "INVALID_CARD", message: "card definition is not in the alpha-12 catalog" };
    const condition = definition.conditions[input.mode];
    if (!condition)
        return { ok: false, code: "CONDITION_NOT_MET", message: "card mode is not supported" };
    if (input.state.phase !== condition.phase) {
        return { ok: false, code: "INVALID_PHASE", message: `card mode requires ${condition.phase}` };
    }
    const self = input.state.players[input.playerId];
    if (condition.requiresOpponentTarget) {
        if (!input.targetPlayerId || input.targetPlayerId === input.playerId || !input.state.players[input.targetPlayerId]) {
            return { ok: false, code: "INVALID_TARGET", message: "an opponent target is required" };
        }
    }
    if (condition.requiresPendingAttackDefender) {
        const pending = input.state.pendingAction;
        const pendingAttack = input.state.pendingAttack;
        if (!pending
            || pending.kind !== "RESPONSE_SELECTION"
            || pending.defendingPlayerId !== input.playerId
            || input.state.respondingPlayerId !== input.playerId
            || !pendingAttack
            || pending.pendingAttackId !== pendingAttack.pendingAttackId
            || pending.defendingPlayerId !== pendingAttack.defendingPlayerId) {
            return { ok: false, code: "CONDITION_NOT_MET", message: "the player is not the current pending-attack defender" };
        }
    }
    if (condition.selfHitPointsAtLeast !== undefined && self.hitPoints < condition.selfHitPointsAtLeast) {
        return { ok: false, code: "CONDITION_NOT_MET", message: "self hit points are below the card condition" };
    }
    if (condition.worldBelowMax && input.state.world.durability >= input.state.world.maxDurability) {
        return { ok: false, code: "CONDITION_NOT_MET", message: "the world is already at maximum durability" };
    }
    if (condition.opponentWorldDamageResponsibilityAtLeast !== undefined) {
        const target = input.targetPlayerId ? input.state.players[input.targetPlayerId] : undefined;
        if (!target || target.worldDamageResponsibility < condition.opponentWorldDamageResponsibilityAtLeast) {
            return { ok: false, code: "CONDITION_NOT_MET", message: "the opponent's world-damage responsibility is below the card condition" };
        }
    }
    if (condition.activeFieldRequired && !input.state.activeField) {
        return { ok: false, code: "CONDITION_NOT_MET", message: "an active field is required" };
    }
    if (condition.handSizeAtLeast !== undefined && self.hand.length < condition.handSizeAtLeast) {
        return { ok: false, code: "CONDITION_NOT_MET", message: "the hand is below the card condition" };
    }
    if (definition.cardDefinitionId === "intervention.careful-redraw.v1") {
        if (!input.discardCardInstanceId
            || input.discardCardInstanceId === input.cardInstanceId
            || !self.hand.includes(input.discardCardInstanceId)
            || input.state.cardZones.inResolution.includes(input.discardCardInstanceId)) {
            return { ok: false, code: "CONDITION_NOT_MET", message: "careful-redraw must discard another card from the player's hand" };
        }
    }
    return { ok: true, definition };
}
export const initial12CommandValidationOptions = {
    cardConditionValidator: (input) => {
        const validation = validateInitial12CardPlay(input);
        if (validation.ok === true)
            return { ok: true };
        return {
            ok: false,
            code: validation.code === "INVALID_TARGET" ? "INVALID_TARGET" : "CARD_CONDITION_NOT_MET",
            message: validation.message,
        };
    },
};
