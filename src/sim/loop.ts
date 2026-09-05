// Fixed-timestep contract. The simulation advances in discrete ticks; the view
// accumulates wall-clock time and calls `tick` zero or more times per frame.
// Nothing in src/sim may read the wall clock: this file is the only place the
// tick duration is defined, and only the view feeds it real time.

export const SIM_TICK_RATE = 20; // ticks per second
export const TICK_MS = 1000 / SIM_TICK_RATE;
export const MAX_TICKS_PER_FRAME = 8; // spiral-of-death guard

/** Convert a per-second rate into a per-tick rate. */
export function perTick(perSecond: number): number {
  return perSecond / SIM_TICK_RATE;
}

/** Convert seconds into a whole number of ticks (never less than 1). */
export function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * SIM_TICK_RATE));
}

export interface Accumulator {
  carry: number; // unspent milliseconds
}

/**
 * Given elapsed wall-clock milliseconds, return how many ticks to run and
 * update the accumulator. Clamps to MAX_TICKS_PER_FRAME so a background tab
 * cannot queue thousands of ticks.
 */
export function accumulate(acc: Accumulator, elapsedMs: number): number {
  acc.carry += Math.max(0, elapsedMs);
  let ticks = Math.floor(acc.carry / TICK_MS);
  if (ticks > MAX_TICKS_PER_FRAME) {
    ticks = MAX_TICKS_PER_FRAME;
    acc.carry = 0;
  } else {
    acc.carry -= ticks * TICK_MS;
  }
  return ticks;
}

/** Interpolation alpha in [0,1) for rendering between ticks. */
export function alpha(acc: Accumulator): number {
  return Math.min(0.999, acc.carry / TICK_MS);
}
