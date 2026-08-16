import { assertGameState } from "./state/invariants.js";
export const PUBLIC_STATE_VERSION = "public-state.alpha-12.v1";
class InvalidPublicStateError extends Error {
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveViewer(state, viewer) {
    if (!isRecord(viewer) || typeof viewer.kind !== "string")
        return null;
    if (viewer.kind === "SPECTATOR")
        return { kind: "SPECTATOR" };
    if (viewer.kind !== "PLAYER" || typeof viewer.playerId !== "string" || !state.players[viewer.playerId])
        return null;
    return { kind: "PLAYER", playerId: viewer.playerId };
}
function cardRef(state, cardInstanceId) {
    const card = state.cardInstances[cardInstanceId];
    if (!card || card.cardInstanceId !== cardInstanceId || typeof card.cardDefinitionId !== "string") {
        throw new InvalidPublicStateError(`public card reference is invalid: ${cardInstanceId}`);
    }
    return { cardInstanceId: card.cardInstanceId, cardDefinitionId: card.cardDefinitionId };
}
function cardRefs(state, cardInstanceIds) {
    return cardInstanceIds.map((cardInstanceId) => cardRef(state, cardInstanceId));
}
function publicHand(state, playerId, viewer) {
    const hand = state.cardZones.hands[playerId];
    if (!hand || !state.players[playerId])
        throw new InvalidPublicStateError(`hand is invalid: ${playerId}`);
    const cards = viewer.kind === "PLAYER" && viewer.playerId === playerId ? cardRefs(state, hand) : null;
    return { count: hand.length, cards };
}
function publicActiveField(field) {
    if (!field)
        return null;
    return {
        fieldDefinitionId: field.fieldDefinitionId,
        ownerPlayerId: field.ownerPlayerId,
        expiresAfterTurnSequence: field.expiresAfterTurnSequence,
    };
}
function publicPendingInteraction(state) {
    const pending = state.pendingAction;
    if (!pending)
        return null;
    if (pending.kind === "RESPONSE_SELECTION") {
        const attack = state.pendingAttack;
        return {
            kind: "RESPONSE_SELECTION",
            pendingAttackId: pending.pendingAttackId,
            attackingPlayerId: pending.attackingPlayerId,
            defendingPlayerId: pending.defendingPlayerId,
            playerId: pending.attackingPlayerId,
            card: cardRef(state, pending.cardInstanceId),
            playMode: pending.playMode,
            targetPlayerId: pending.targetPlayerId,
            baseDamage: attack?.pendingAttackId === pending.pendingAttackId ? attack.baseDamage : null,
        };
    }
    const attack = state.pendingAttack;
    return {
        kind: "CARD_RESOLUTION",
        pendingAttackId: attack?.pendingAttackId ?? null,
        attackingPlayerId: attack?.attackingPlayerId ?? pending.playerId,
        defendingPlayerId: attack?.defendingPlayerId ?? null,
        playerId: pending.playerId,
        card: cardRef(state, pending.cardInstanceId),
        playMode: pending.playMode,
        targetPlayerId: pending.targetPlayerId,
        baseDamage: attack?.baseDamage ?? null,
    };
}
function publicStatusEffects(state, playerId) {
    const effects = state.players[playerId].statusEffects;
    return {
        nextDefensePenalty: effects.nextDefensePenalty,
        fragileWorld: effects.fragileWorld,
        shields: effects.shields.map((shield) => ({
            amount: shield.amount,
            scope: shield.scope,
            pendingAttackId: shield.pendingAttackId,
            expiresAfterTurnSequence: shield.expiresAfterTurnSequence,
        })),
        statModifiers: effects.statModifiers.map((modifier) => ({
            stat: modifier.stat,
            delta: modifier.delta,
            expiresAfterTurnSequence: modifier.expiresAfterTurnSequence,
        })),
    };
}
function project(state, viewer) {
    const players = state.initialPlayerOrder.map((playerId) => {
        const player = state.players[playerId];
        if (!player)
            throw new InvalidPublicStateError(`player is invalid: ${playerId}`);
        return {
            playerId,
            hp: player.hitPoints,
            maxHp: player.maxHitPoints,
            hand: publicHand(state, playerId, viewer),
            worldDamageResponsibility: player.worldDamageResponsibility,
            effectiveWorldRestore: player.effectiveWorldRestore,
            survivedRoundCount: player.survivedRoundCount,
            statusEffects: publicStatusEffects(state, playerId),
        };
    });
    return {
        publicStateVersion: PUBLIC_STATE_VERSION,
        matchId: state.matchId,
        rulesetId: state.ruleset.rulesetId,
        handLimit: state.ruleset.handLimit,
        catalogHash: state.catalogHash,
        engineVersion: state.engineVersion,
        revision: state.revision,
        phase: state.phase,
        roundNumber: state.roundNumber,
        turnSequence: state.turnSequence,
        initialPlayerOrder: [...state.initialPlayerOrder],
        activePlayerId: state.activePlayerId,
        respondingPlayerId: state.respondingPlayerId,
        players,
        drawPileCount: state.cardZones.drawPile.length,
        discardPile: cardRefs(state, state.cardZones.discardPile),
        revealedCards: cardRefs(state, state.cardZones.revealedCards),
        inResolution: cardRefs(state, state.cardZones.inResolution),
        world: {
            durability: state.world.durability,
            maxDurability: state.world.maxDurability,
            triggeredThresholds: [...state.world.triggeredThresholds],
            worldLawId: state.world.worldLawId,
            collapseResponsiblePlayerId: state.world.collapseResponsiblePlayerId,
        },
        activeField: publicActiveField(state.activeField),
        pendingInteraction: publicPendingInteraction(state),
        terminalFlags: {
            worldCollapsed: state.terminalFlags.worldCollapsed,
            defeatedPlayerIds: [...state.terminalFlags.defeatedPlayerIds],
            maxRoundsReached: state.terminalFlags.maxRoundsReached,
            endKind: state.terminalFlags.endKind,
            battleWinnerId: state.terminalFlags.battleWinnerId,
            divineSelectionWinnerId: state.terminalFlags.divineSelectionWinnerId,
        },
    };
}
/** Projects authoritative state into the viewer-specific, secret-safe state. */
export function projectPublicState(state, viewer) {
    const resolvedViewer = resolveViewer(state, viewer);
    if (!resolvedViewer)
        return { ok: false, code: "UNKNOWN_VIEWER" };
    try {
        assertGameState(state);
        return { ok: true, state: project(state, resolvedViewer) };
    }
    catch {
        return { ok: false, code: "INVALID_STATE" };
    }
}
export const getPublicState = projectPublicState;
export const createPublicState = projectPublicState;
