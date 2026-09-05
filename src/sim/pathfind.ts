// A* over the tile grid with 8-way movement and per-locomotor terrain costs.
// Deterministic: ties break on insertion order via a binary heap keyed by
// (f, g, seq). Bounded expansion so a blocked goal cannot stall a tick; when
// the goal is unreachable the path to the closest explored tile is returned.

import { type Locomotor, type MapData, Terrain, idx, inBounds, isPassable, terrainCost } from "./map";

const MAX_EXPAND = 18000;

interface Node {
  f: number;
  g: number;
  seq: number;
  i: number;
}

class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i] as Node, a[p] as Node)) {
        const t = a[i] as Node;
        a[i] = a[p] as Node;
        a[p] = t;
        i = p;
      } else break;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0] as Node;
    const last = a.pop() as Node;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l] as Node, a[m] as Node)) m = l;
        if (r < a.length && less(a[r] as Node, a[m] as Node)) m = r;
        if (m === i) break;
        const t = a[i] as Node;
        a[i] = a[m] as Node;
        a[m] = t;
        i = m;
      }
    }
    return top;
  }
}

function less(a: Node, b: Node): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.g !== b.g) return a.g > b.g; // prefer deeper on ties
  return a.seq < b.seq;
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 100],
  [-1, 0, 100],
  [0, 1, 100],
  [0, -1, 100],
  [1, 1, 141],
  [1, -1, 141],
  [-1, 1, 141],
  [-1, -1, 141],
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return 100 * (dx + dy) + (141 - 200) * Math.min(dx, dy);
}

/**
 * Find a tile path from (sx,sy) to (gx,gy). Returns tiles excluding the start,
 * including the goal (or the closest reachable tile). Empty array when
 * already there or nothing is reachable.
 */
export function findPath(
  m: MapData,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  loco: Locomotor,
  selfId = -1,
  team = -1,
): Array<[number, number]> {
  if (sx === gx && sy === gy) return [];
  if (!inBounds(m, sx, sy)) return [];
  if (loco === "air") return [[gx, gy]];
  const n = m.width * m.height;
  const gScore = new Int32Array(n).fill(0x7fffffff);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = idx(m, sx, sy);
  const goal = idx(m, gx, gy);
  const heap = new Heap();
  let seq = 0;
  gScore[start] = 0;
  heap.push({ f: heuristic(sx, sy, gx, gy), g: 0, seq: seq++, i: start });
  let best = start;
  let bestH = heuristic(sx, sy, gx, gy);
  let expanded = 0;
  const goalPassable = isPassable(m, gx, gy, loco, selfId, team);

  while (heap.size > 0 && expanded < MAX_EXPAND) {
    const cur = heap.pop() as Node;
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    expanded++;
    if (cur.i === goal) {
      best = goal;
      break;
    }
    const cx = cur.i % m.width;
    const cy = (cur.i / m.width) | 0;
    const h = heuristic(cx, cy, gx, gy);
    if (h < bestH) {
      bestH = h;
      best = cur.i;
    }
    // Reached a neighbour of an impassable goal (e.g. a structure): stop there.
    if (!goalPassable && Math.abs(cx - gx) <= 1 && Math.abs(cy - gy) <= 1) {
      best = cur.i;
      break;
    }
    for (let d = 0; d < DIRS.length; d++) {
      const [dx, dy, base] = DIRS[d] as [number, number, number];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(m, nx, ny)) continue;
      const ni = idx(m, nx, ny);
      if (closed[ni]) continue;
      const t = m.terrain[ni] as Terrain;
      const tc = terrainCost(t, loco);
      if (tc === 0) continue;
      const occ = m.occupancy[ni] as number;
      if (occ !== -1 && occ !== selfId && ni !== goal && !(team >= 0 && (m.gateTeam[ni] as number) === team)) continue;
      // No corner cutting past impassable cells.
      if (dx !== 0 && dy !== 0) {
        if (!isPassable(m, cx + dx, cy, loco, selfId, team) || !isPassable(m, cx, cy + dy, loco, selfId, team)) continue;
      }
      const g = cur.g + ((base * tc) / 100) | 0;
      if (g < (gScore[ni] as number)) {
        gScore[ni] = g;
        came[ni] = cur.i;
        heap.push({ f: g + heuristic(nx, ny, gx, gy), g, seq: seq++, i: ni });
      }
    }
  }
  if (best === start) return [];
  const path: Array<[number, number]> = [];
  let cur = best;
  while (cur !== start && cur !== -1) {
    path.push([cur % m.width, (cur / m.width) | 0]);
    cur = came[cur] as number;
  }
  path.reverse();
  return path;
}

/** Nearest passable tile to (tx,ty) for a locomotor, spiralling outward. */
export function nearestPassable(m: MapData, tx: number, ty: number, loco: Locomotor, maxR = 8): [number, number] | null {
  if (isPassable(m, tx, ty, loco)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (isPassable(m, x, y, loco)) return [x, y];
      }
    }
  }
  return null;
}
