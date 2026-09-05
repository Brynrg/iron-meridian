// The single owner of coordinate conversion.
//
// World space is integer "leptons": one map cell is LEPTONS_PER_CELL wide.
// Tile space is integer cell indices. Screen space (pixels) exists only in the
// view; the conversions that need a camera take it as a plain value so this
// module stays free of view state.

export const LEPTONS_PER_CELL = 256;
export const CELL_PX = 24; // pixels per cell at zoom 1
export const HALF_CELL = LEPTONS_PER_CELL / 2;
export const FACINGS = 32; // unit facing resolution

export interface Camera {
  x: number; // world px of the viewport's top-left
  y: number;
  width: number; // viewport px
  height: number;
}

export function worldToTile(v: number): number {
  return Math.floor(v / LEPTONS_PER_CELL);
}

export function tileToWorldCenter(t: number): number {
  return t * LEPTONS_PER_CELL + HALF_CELL;
}

export function tileToWorldOrigin(t: number): number {
  return t * LEPTONS_PER_CELL;
}

export function worldToPx(v: number): number {
  return (v * CELL_PX) / LEPTONS_PER_CELL;
}

export function pxToWorld(px: number): number {
  return Math.round((px * LEPTONS_PER_CELL) / CELL_PX);
}

export function worldToScreen(cam: Camera, wx: number, wy: number): [number, number] {
  return [worldToPx(wx) - cam.x, worldToPx(wy) - cam.y];
}

export function screenToWorld(cam: Camera, sx: number, sy: number): [number, number] {
  return [pxToWorld(sx + cam.x), pxToWorld(sy + cam.y)];
}

export function screenToTile(cam: Camera, sx: number, sy: number): [number, number] {
  const [wx, wy] = screenToWorld(cam, sx, sy);
  return [worldToTile(wx), worldToTile(wy)];
}

export function cellsToLeptons(cells: number): number {
  return Math.round(cells * LEPTONS_PER_CELL);
}

/** Integer distance (leptons), Euclidean rounded. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Facing index 0..FACINGS-1 with 0 = north, increasing clockwise. */
export function facingFromDelta(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const angle = Math.atan2(dx, -dy); // 0 at north, clockwise positive
  let f = Math.round((angle / (Math.PI * 2)) * FACINGS);
  f = ((f % FACINGS) + FACINGS) % FACINGS;
  return f;
}

export function facingToRadians(f: number): number {
  return (f / FACINGS) * Math.PI * 2;
}

/** Rotate `from` toward `to` by at most `step` facings, shortest way round. */
export function turnToward(from: number, to: number, step: number): number {
  let d = ((to - from) % FACINGS + FACINGS) % FACINGS;
  if (d > FACINGS / 2) d -= FACINGS;
  if (Math.abs(d) <= step) return to;
  return (((from + Math.sign(d) * step) % FACINGS) + FACINGS) % FACINGS;
}
