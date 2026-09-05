// Deterministic PRNG (mulberry32). Integer state so it serialises trivially
// and replays across browsers bit-for-bit. Never use Math.random in src/sim.

export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Next 32-bit unsigned integer. */
export function nextU32(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  if (n <= 0) return 0;
  return nextU32(rng) % n;
}

/** Integer in [lo, hi] inclusive. */
export function nextRange(rng: Rng, lo: number, hi: number): number {
  return lo + nextInt(rng, hi - lo + 1);
}

/** Float in [0,1). Only for non-gameplay jitter that is still deterministic. */
export function nextFloat(rng: Rng): number {
  return nextU32(rng) / 4294967296;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[nextInt(rng, arr.length)];
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
  return arr;
}
