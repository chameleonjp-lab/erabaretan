import { createInitialGameState } from "../../../game-core/src/state/create-initial-state.js";
import { ALPHA_12_RULESET } from "../../../game-core/src/state/rules.js";
import { createDeterministicRng, RNG_ALGORITHM_VERSION, SHUFFLE_ALGORITHM_VERSION, shuffleFisherYatesDesc, } from "../../../game-core/src/rng/xoshiro128ss.js";
import { INITIAL_12_CARD_DEFINITIONS } from "../cards/initial-12.js";
export const ALPHA_12_CATALOG_HASH = "catalog.alpha-12.v1";
export const ALPHA_12_ENGINE_VERSION = "game-core.alpha-12.v1";
function compareUtf8(left, right) {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index += 1) {
        if (leftBytes[index] !== rightBytes[index])
            return leftBytes[index] - rightBytes[index];
    }
    return leftBytes.length - rightBytes.length;
}
export function sortInitial12Definitions(definitions = INITIAL_12_CARD_DEFINITIONS) {
    return [...definitions].sort((left, right) => compareUtf8(left.cardDefinitionId, right.cardDefinitionId));
}
export function buildInitial12Deck(definitions = INITIAL_12_CARD_DEFINITIONS) {
    return sortInitial12Definitions(definitions).flatMap((definition) => Array.from({ length: definition.copiesInDeck }, (_, index) => `${definition.cardDefinitionId}#${String(index + 1).padStart(2, "0")}`));
}
function cardInstancesForSetup(sortedDeck, hands, playerIds) {
    const owners = new Map();
    for (const [playerId, hand] of Object.entries(hands)) {
        for (const cardInstanceId of hand)
            owners.set(cardInstanceId, playerId);
    }
    return sortedDeck.map((cardInstanceId, drawOrder) => {
        const separator = cardInstanceId.lastIndexOf("#");
        const cardDefinitionId = cardInstanceId.slice(0, separator);
        return {
            cardInstanceId,
            cardDefinitionId,
            ownerPlayerId: owners.get(cardInstanceId) ?? playerIds[0],
            zone: owners.has(cardInstanceId) ? "HAND" : "DRAW_PILE",
            drawOrder,
        };
    });
}
export function createAlpha12Setup(input) {
    const playerIds = input.playerIds ?? ["P1", "P2"];
    const ruleset = input.ruleset ?? ALPHA_12_RULESET;
    const sortedDeck = buildInitial12Deck();
    const rng = createDeterministicRng(input.seed);
    const shuffledDeck = shuffleFisherYatesDesc(sortedDeck, rng);
    const hands = { [playerIds[0]]: [], [playerIds[1]]: [] };
    for (let index = 0; index < ruleset.startingHand * playerIds.length; index += 1) {
        hands[playerIds[index % playerIds.length]].push(shuffledDeck[index]);
    }
    const drawPile = shuffledDeck.slice(ruleset.startingHand * playerIds.length);
    const firstPlayerId = playerIds[rng.nextInt(playerIds.length)];
    const cardInstances = cardInstancesForSetup(sortedDeck, hands, playerIds);
    const state = createInitialGameState({
        matchId: input.matchId,
        catalogHash: input.catalogHash ?? ALPHA_12_CATALOG_HASH,
        engineVersion: input.engineVersion ?? ALPHA_12_ENGINE_VERSION,
        rngAlgorithmVersion: RNG_ALGORITHM_VERSION,
        shuffleAlgorithmVersion: SHUFFLE_ALGORITHM_VERSION,
        seed: input.seed,
        ruleset,
        players: [
            { playerId: playerIds[0], hand: hands[playerIds[0]] },
            { playerId: playerIds[1], hand: hands[playerIds[1]] },
        ],
        initialPlayerOrder: playerIds,
        firstPlayerId,
        cardInstances,
        drawPile,
        randomConsumptionCount: rng.randomConsumptionCount,
    });
    return {
        state,
        initialPlayerOrder: playerIds,
        firstPlayerId,
        shuffledDeck,
        hands,
        drawPile,
        cardInstances,
        randomConsumptionCount: rng.randomConsumptionCount,
    };
}
export function createAlpha12InitialGameState(input) {
    return createAlpha12Setup(input).state;
}
