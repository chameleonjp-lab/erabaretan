import type { GameState, PlayerState } from "../state/types.ts";

export const STATE_HASH_VERSION = "state-hash.alpha-12.v1" as const;
const UINT32_RANGE = 0x1_0000_0000;

export interface StateHashProjection {
  readonly stateHashVersion: string;
  readonly activeField: GameState["activeField"];
  readonly activePlayerId: GameState["activePlayerId"];
  readonly cardZones: {
    readonly discardPile: readonly string[];
    readonly drawPile: readonly string[];
    readonly hands: Readonly<Record<string, readonly string[]>>;
    readonly revealedCards: readonly string[];
  };
  readonly effectQueue: readonly unknown[];
  readonly engineVersion: string;
  readonly judgment: GameState["judgment"];
  readonly matchId: string;
  readonly pendingAction: GameState["pendingAction"];
  readonly phase: GameState["phase"];
  readonly players: Readonly<Record<string, HashablePlayerState>>;
  readonly randomConsumptionCount: number;
  readonly revision: number;
  readonly rngAlgorithmVersion: string;
  readonly roundNumber: number;
  readonly rulesetId: string;
  readonly seed: string;
  readonly shuffleAlgorithmVersion: string;
  readonly terminalFlags: GameState["terminalFlags"];
  readonly turnSequence: number;
  readonly world: {
    readonly durability: number;
    readonly maxDurability: number;
    readonly triggeredThresholds: readonly number[];
    readonly worldLawId: string;
  };
}

export interface HashablePlayerState {
  readonly effectiveWorldRestore: number;
  readonly hand: readonly string[];
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly statusEffects: PlayerState["statusEffects"];
  readonly survivedRoundCount: number;
  readonly worldDamageResponsibility: number;
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index].codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index].codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJsonValue(value: unknown, inArray = false): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("state hash input cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (value === undefined) return inArray ? "null" : "";
  if (typeof value !== "object") throw new Error(`state hash input contains unsupported value: ${typeof value}`);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonValue(item, true)).join(",")}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareUnicodeCodePoints);
  return `{${keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value);
}

export function projectStateForHash(state: GameState): StateHashProjection {
  const players: Record<string, HashablePlayerState> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    players[playerId] = {
      effectiveWorldRestore: player.effectiveWorldRestore,
      hand: [...player.hand],
      hitPoints: player.hitPoints,
      maxHitPoints: player.maxHitPoints,
      statusEffects: player.statusEffects,
      survivedRoundCount: player.survivedRoundCount,
      worldDamageResponsibility: player.worldDamageResponsibility,
    };
  }

  return {
    stateHashVersion: state.stateHashVersion,
    activeField: state.activeField,
    activePlayerId: state.activePlayerId,
    cardZones: {
      discardPile: [...state.cardZones.discardPile],
      drawPile: [...state.cardZones.drawPile],
      hands: Object.fromEntries(Object.entries(state.cardZones.hands).map(([playerId, hand]) => [playerId, [...hand]])),
      revealedCards: [...state.cardZones.revealedCards],
    },
    effectQueue: [...state.effectQueue],
    engineVersion: state.engineVersion,
    judgment: state.judgment,
    matchId: state.matchId,
    pendingAction: state.pendingAction,
    phase: state.phase,
    players,
    randomConsumptionCount: state.randomConsumptionCount,
    revision: state.revision,
    rngAlgorithmVersion: state.rngAlgorithmVersion,
    roundNumber: state.roundNumber,
    rulesetId: state.ruleset.rulesetId,
    seed: state.seed,
    shuffleAlgorithmVersion: state.shuffleAlgorithmVersion,
    terminalFlags: state.terminalFlags,
    turnSequence: state.turnSequence,
    world: {
      durability: state.world.durability,
      maxDurability: state.world.maxDurability,
      triggeredThresholds: [...state.world.triggeredThresholds],
      worldLawId: state.world.worldLawId,
    },
  };
}

export function serializeStateForHash(state: GameState): string {
  return canonicalJson(projectStateForHash(state));
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

function rotr32(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const highLength = Math.floor(bitLength / UINT32_RANGE);
  const lowLength = bitLength >>> 0;
  padded[padded.length - 8] = (highLength >>> 24) & 0xff;
  padded[padded.length - 7] = (highLength >>> 16) & 0xff;
  padded[padded.length - 6] = (highLength >>> 8) & 0xff;
  padded[padded.length - 5] = highLength & 0xff;
  padded[padded.length - 4] = (lowLength >>> 24) & 0xff;
  padded[padded.length - 3] = (lowLength >>> 16) & 0xff;
  padded[padded.length - 2] = (lowLength >>> 8) & 0xff;
  padded[padded.length - 1] = lowLength & 0xff;

  const hash: number[] = [...SHA256_INITIAL];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = ((padded[position] << 24) | (padded[position + 1] << 16) | (padded[position + 2] << 8) | padded[position + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const value1 = (rotr32(words[index - 15], 7) ^ rotr32(words[index - 15], 18) ^ (words[index - 15] >>> 3)) >>> 0;
      const value2 = (rotr32(words[index - 2], 17) ^ rotr32(words[index - 2], 19) ^ (words[index - 2] >>> 10)) >>> 0;
      words[index] = (words[index - 16] + value1 + words[index - 7] + value2) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sigma0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  for (let index = 0; index < hash.length; index += 1) {
    output[index * 4] = (hash[index] >>> 24) & 0xff;
    output[index * 4 + 1] = (hash[index] >>> 16) & 0xff;
    output[index * 4 + 2] = (hash[index] >>> 8) & 0xff;
    output[index * 4 + 3] = hash[index] & 0xff;
  }
  return output;
}

export function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return Array.from(sha256Bytes(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashGameState(state: GameState): string {
  return sha256Hex(serializeStateForHash(state));
}

export const calculateStateHash = hashGameState;
