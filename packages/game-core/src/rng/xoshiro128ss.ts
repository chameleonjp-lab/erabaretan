import type { GameState } from "../state/types.ts";

export const RNG_ALGORITHM_VERSION = "rng.xoshiro128ss.v1" as const;
export const SHUFFLE_ALGORITHM_VERSION = "shuffle.fisher-yates-desc.v1" as const;
export const UINT32_RANGE = 0x1_0000_0000;
const SEED_PATTERN = /^[0-9a-f]{32}$/;

export type SeedWords = readonly [number, number, number, number];

export interface DeterministicRngSnapshot {
  readonly seed: string;
  readonly state: SeedWords;
  readonly randomConsumptionCount: number;
}

export interface DeterministicRng {
  readonly algorithmVersion: typeof RNG_ALGORITHM_VERSION;
  readonly seed: string;
  readonly randomConsumptionCount: number;
  nextUint32(): number;
  nextInt(maxExclusive: number): number;
  snapshot(): DeterministicRngSnapshot;
  clone(): DeterministicRng;
}

function assertSafeConsumptionCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`randomConsumptionCount must be a non-negative safe integer, got ${value}`);
  }
}

function rotl32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export function parseSeed(seed: string): SeedWords {
  if (typeof seed !== "string" || !SEED_PATTERN.test(seed)) {
    throw new Error("seed must be exactly 32 lowercase hexadecimal characters");
  }
  const words = [
    Number.parseInt(seed.slice(0, 8), 16) >>> 0,
    Number.parseInt(seed.slice(8, 16), 16) >>> 0,
    Number.parseInt(seed.slice(16, 24), 16) >>> 0,
    Number.parseInt(seed.slice(24, 32), 16) >>> 0,
  ] as const;
  if (words.every((word) => word === 0)) {
    throw new Error("seed must not contain four zero words");
  }
  return words;
}

export function formatSeed(words: SeedWords): string {
  if (words.length !== 4 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff_ffff)) {
    throw new Error("seed words must contain four unsigned 32-bit integers");
  }
  const seed = words.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
  parseSeed(seed);
  return seed;
}

export function createSeed(randomSource: { getRandomValues(values: Uint32Array): Uint32Array } = globalThis.crypto): string {
  if (!randomSource || typeof randomSource.getRandomValues !== "function") {
    throw new Error("a Web Crypto getRandomValues implementation is required to create a seed");
  }
  for (;;) {
    const words = randomSource.getRandomValues(new Uint32Array(4));
    const seedWords = [words[0] >>> 0, words[1] >>> 0, words[2] >>> 0, words[3] >>> 0] as SeedWords;
    if (seedWords.every((word) => word === 0)) continue;
    const seed = formatSeed(seedWords);
    if (seed !== "00000000000000000000000000000000") return seed;
  }
}

class Xoshiro128StarStar implements DeterministicRng {
  public readonly algorithmVersion = RNG_ALGORITHM_VERSION;
  public readonly seed: string;
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private count: number;

  public constructor(seed: string, words: SeedWords, randomConsumptionCount = 0) {
    parseSeed(seed);
    assertSafeConsumptionCount(randomConsumptionCount);
    this.seed = seed;
    this.s0 = words[0] >>> 0;
    this.s1 = words[1] >>> 0;
    this.s2 = words[2] >>> 0;
    this.s3 = words[3] >>> 0;
    this.count = 0;
    for (let index = 0; index < randomConsumptionCount; index += 1) this.nextUint32();
  }

  public get randomConsumptionCount(): number {
    return this.count;
  }

  public nextUint32(): number {
    const result = Math.imul(rotl32(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl32(this.s3, 11);
    this.count += 1;
    return result;
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new Error(`maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`);
    }
    if (maxExclusive === UINT32_RANGE) return this.nextUint32();

    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    for (;;) {
      const raw = this.nextUint32();
      if (raw < limit) return raw % maxExclusive;
    }
  }

  public snapshot(): DeterministicRngSnapshot {
    return {
      seed: this.seed,
      state: [this.s0, this.s1, this.s2, this.s3],
      randomConsumptionCount: this.count,
    };
  }

  public clone(): DeterministicRng {
    const copy = new Xoshiro128StarStar(this.seed, parseSeed(this.seed));
    copy.s0 = this.s0;
    copy.s1 = this.s1;
    copy.s2 = this.s2;
    copy.s3 = this.s3;
    copy.count = this.count;
    return copy;
  }
}

export function createDeterministicRng(seed: string, randomConsumptionCount = 0): DeterministicRng {
  return new Xoshiro128StarStar(seed, parseSeed(seed), randomConsumptionCount);
}

export function createRngForState(state: Pick<GameState, "seed" | "randomConsumptionCount">): DeterministicRng {
  return createDeterministicRng(state.seed, state.randomConsumptionCount);
}

export function shuffleFisherYatesDesc<T>(values: readonly T[], rng: DeterministicRng): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index >= 1; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export const createXoshiro128ss = createDeterministicRng;
export const shuffle = shuffleFisherYatesDesc;
