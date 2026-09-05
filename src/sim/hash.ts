// FNV-1a style rolling hash over integers. Used for the per-tick state hash
// that replays and lockstep peers compare to detect divergence.

export interface Hasher {
  h: number;
}

export function createHasher(): Hasher {
  return { h: 0x811c9dc5 };
}

export function mixInt(hs: Hasher, v: number): void {
  // Fold the integer in 4 byte-steps so sign and magnitude both matter.
  let x = v | 0;
  for (let i = 0; i < 4; i++) {
    hs.h ^= x & 0xff;
    hs.h = Math.imul(hs.h, 0x01000193) >>> 0;
    x >>>= 8;
  }
}

export function mixString(hs: Hasher, s: string): void {
  for (let i = 0; i < s.length; i++) mixInt(hs, s.charCodeAt(i));
}

export function finish(hs: Hasher): number {
  return hs.h >>> 0;
}

export function hashToHex(h: number): string {
  return h.toString(16).padStart(8, "0");
}
