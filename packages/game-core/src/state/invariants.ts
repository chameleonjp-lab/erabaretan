import type { CardInstanceId, CardZone, GamePhase, GameState, PlayerId } from "./types.ts";

const PHASES: readonly GamePhase[] = [
  "SETUP",
  "TURN_START",
  "ACTION_SELECTION",
  "RESPONSE_SELECTION",
  "RESOLUTION",
  "TURN_END",
  "JUDGMENT",
  "FINISHED",
];

function countReferences(groups: readonly (readonly string[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const id of group) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got ${value}`);
  }
}

export function assertGameState(state: GameState): void {
  if (!PHASES.includes(state.phase)) throw new Error(`Unknown phase: ${state.phase}`);
  if (state.initialPlayerOrder.length !== 2) throw new Error("initialPlayerOrder must contain two players");
  if (new Set(state.initialPlayerOrder).size !== 2) throw new Error("initialPlayerOrder must be unique");
  if (Object.keys(state.players).length !== state.ruleset.playerCount) {
    throw new Error("player count does not match the ruleset");
  }
  if (!state.players[state.initialPlayerOrder[0]] || !state.players[state.initialPlayerOrder[1]]) {
    throw new Error("initialPlayerOrder contains an unknown player");
  }
  if (state.activePlayerId !== null && !state.players[state.activePlayerId]) {
    throw new Error("activePlayerId is unknown");
  }
  if (state.respondingPlayerId !== null && !state.players[state.respondingPlayerId]) {
    throw new Error("respondingPlayerId is unknown");
  }
  assertIntegerInRange("revision", state.revision, 0, Number.MAX_SAFE_INTEGER);
  assertIntegerInRange("roundNumber", state.roundNumber, 1, state.ruleset.maxRounds + 1);
  assertIntegerInRange("turnSequence", state.turnSequence, 1, Number.MAX_SAFE_INTEGER);
  assertIntegerInRange("randomConsumptionCount", state.randomConsumptionCount, 0, Number.MAX_SAFE_INTEGER);
  assertIntegerInRange("world.durability", state.world.durability, 0, state.world.maxDurability);
  if (state.world.maxDurability !== state.ruleset.worldMaxDurability) {
    throw new Error("world.maxDurability must match the ruleset");
  }
  if (state.world.worldLawId !== state.ruleset.worldLawId) {
    throw new Error("world.worldLawId must match the ruleset");
  }
  if (state.world.triggeredThresholds.some((threshold) => !state.ruleset.worldThresholds.includes(threshold))) {
    throw new Error("world.triggeredThresholds contains an unknown threshold");
  }
  if (new Set(state.world.triggeredThresholds).size !== state.world.triggeredThresholds.length) {
    throw new Error("world.triggeredThresholds must not contain duplicates");
  }

  const zoneGroups: readonly (readonly string[])[] = [
    state.cardZones.drawPile,
    state.cardZones.discardPile,
    state.cardZones.revealedCards,
    state.cardZones.inResolution,
    ...Object.values(state.cardZones.hands),
  ];
  const references = countReferences(zoneGroups);
  const cardIds = Object.keys(state.cardInstances);
  if (references.size !== cardIds.length) throw new Error("every card instance must be in exactly one zone");
  for (const cardId of cardIds) {
    if (references.get(cardId) !== 1) throw new Error(`card ${cardId} appears in multiple or no zones`);
  }
  for (const [playerId, player] of Object.entries(state.players)) {
    if (player.playerId !== playerId) throw new Error(`player key mismatch: ${playerId}`);
    assertIntegerInRange(`${playerId}.hitPoints`, player.hitPoints, 0, player.maxHitPoints);
    assertIntegerInRange(`${playerId}.maxHitPoints`, player.maxHitPoints, 1, state.ruleset.maxHp);
    assertIntegerInRange(`${playerId}.worldDamageResponsibility`, player.worldDamageResponsibility, 0, Number.MAX_SAFE_INTEGER);
    assertIntegerInRange(`${playerId}.effectiveWorldRestore`, player.effectiveWorldRestore, 0, Number.MAX_SAFE_INTEGER);
    assertIntegerInRange(`${playerId}.survivedRoundCount`, player.survivedRoundCount, 0, state.ruleset.maxRounds);
    assertIntegerInRange(`${playerId}.nextDefensePenalty`, player.statusEffects.nextDefensePenalty, 0, Number.MAX_SAFE_INTEGER);
    const hand = state.cardZones.hands[playerId];
    if (!hand) throw new Error(`missing cardZones hand for ${playerId}`);
    if (hand.length !== player.hand.length || hand.some((cardId, index) => cardId !== player.hand[index])) {
      throw new Error(`${playerId}.hand must equal cardZones.hands[${playerId}]`);
    }
  }
  for (const [cardId, card] of Object.entries(state.cardInstances)) {
    if (card.cardInstanceId !== cardId) throw new Error(`card key mismatch: ${cardId}`);
    if (!state.players[card.ownerPlayerId]) throw new Error(`card ${cardId} has unknown owner`);
    const actualZone = findCardZone(state, cardId);
    if (actualZone !== card.zone) throw new Error(`card ${cardId} zone mismatch: ${card.zone} vs ${actualZone}`);
  }
  if (state.effectQueue.length > state.ruleset.maxEffectsPerResolution) {
    throw new Error("effect queue exceeds the ruleset limit");
  }
  if (state.phase === "RESPONSE_SELECTION") {
    if (!state.pendingAction || state.pendingAction.kind !== "RESPONSE_SELECTION") {
      throw new Error("RESPONSE_SELECTION requires a response pendingAction");
    }
    if (!state.respondingPlayerId) throw new Error("RESPONSE_SELECTION requires respondingPlayerId");
  }
  if (state.phase === "FINISHED" && state.terminalFlags.endKind === null) {
    throw new Error("FINISHED requires an endKind");
  }
  if (state.phase !== "FINISHED" && state.terminalFlags.endKind !== null) {
    throw new Error("non-FINISHED state cannot have an endKind");
  }
}

export function findCardZone(state: GameState, cardInstanceId: CardInstanceId): CardZone {
  if (state.cardZones.drawPile.includes(cardInstanceId)) return "DRAW_PILE";
  if (state.cardZones.discardPile.includes(cardInstanceId)) return "DISCARD_PILE";
  if (state.cardZones.revealedCards.includes(cardInstanceId)) return "REVEALED";
  if (state.cardZones.inResolution.includes(cardInstanceId)) return "RESOLUTION";
  for (const hand of Object.values(state.cardZones.hands)) {
    if (hand.includes(cardInstanceId)) return "HAND";
  }
  throw new Error(`card is not present in any zone: ${cardInstanceId}`);
}

export function getPlayer(state: GameState, playerId: PlayerId) {
  const player = state.players[playerId];
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return player;
}
