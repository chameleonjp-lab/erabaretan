import type { CardInstanceId, CardInstanceState, GameState, PlayerId, RulesetSnapshot } from "../../../game-core/src/state/types.ts";
import { createInitialGameState } from "../../../game-core/src/state/create-initial-state.ts";
import { ALPHA_12_RULESET } from "../../../game-core/src/state/rules.ts";
import {
  createDeterministicRng,
  RNG_ALGORITHM_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  shuffleFisherYatesDesc,
} from "../../../game-core/src/rng/xoshiro128ss.ts";
import { INITIAL_12_CARD_DEFINITIONS, type InitialCardDefinition } from "../cards/initial-12.ts";

export const ALPHA_12_CATALOG_HASH = "catalog.alpha-12.v1" as const;
export const ALPHA_12_ENGINE_VERSION = "game-core.alpha-12.v1" as const;

export interface Alpha12SetupInput {
  readonly matchId: string;
  readonly seed: string;
  readonly playerIds?: readonly [PlayerId, PlayerId];
  readonly catalogHash?: string;
  readonly engineVersion?: string;
  readonly ruleset?: RulesetSnapshot;
}

export interface Alpha12SetupResult {
  readonly state: GameState;
  readonly initialPlayerOrder: readonly [PlayerId, PlayerId];
  readonly firstPlayerId: PlayerId;
  readonly shuffledDeck: readonly CardInstanceId[];
  readonly hands: Readonly<Record<PlayerId, readonly CardInstanceId[]>>;
  readonly drawPile: readonly CardInstanceId[];
  readonly cardInstances: readonly CardInstanceState[];
  readonly randomConsumptionCount: number;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

export function sortInitial12Definitions(definitions: readonly InitialCardDefinition[] = INITIAL_12_CARD_DEFINITIONS): InitialCardDefinition[] {
  return [...definitions].sort((left, right) => compareUtf8(left.cardDefinitionId, right.cardDefinitionId));
}

export function buildInitial12Deck(
  definitions: readonly InitialCardDefinition[] = INITIAL_12_CARD_DEFINITIONS,
): CardInstanceId[] {
  return sortInitial12Definitions(definitions).flatMap((definition) => Array.from(
    { length: definition.copiesInDeck },
    (_, index) => `${definition.cardDefinitionId}#${String(index + 1).padStart(2, "0")}`,
  ));
}

function cardInstancesForSetup(
  sortedDeck: readonly CardInstanceId[],
  hands: Readonly<Record<PlayerId, readonly CardInstanceId[]>>,
  playerIds: readonly [PlayerId, PlayerId],
): CardInstanceState[] {
  const owners = new Map<CardInstanceId, PlayerId>();
  for (const [playerId, hand] of Object.entries(hands)) {
    for (const cardInstanceId of hand) owners.set(cardInstanceId, playerId);
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

export function createAlpha12Setup(input: Alpha12SetupInput): Alpha12SetupResult {
  const playerIds = input.playerIds ?? ["P1", "P2"];
  const ruleset = input.ruleset ?? ALPHA_12_RULESET;
  const sortedDeck = buildInitial12Deck();
  const rng = createDeterministicRng(input.seed);
  const shuffledDeck = shuffleFisherYatesDesc(sortedDeck, rng);
  const hands: Record<PlayerId, CardInstanceId[]> = { [playerIds[0]]: [], [playerIds[1]]: [] };
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

export function createAlpha12InitialGameState(input: Alpha12SetupInput): GameState {
  return createAlpha12Setup(input).state;
}
