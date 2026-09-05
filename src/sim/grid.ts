// Bucketed spatial index over actor positions. Rebuilt each tick (cheap for a
// few hundred actors) so it is never stale. Queries return actor ids.

import { LEPTONS_PER_CELL } from "./coords";

const BUCKET_CELLS = 4; // bucket = 4x4 cells
const BUCKET_LEPTONS = BUCKET_CELLS * LEPTONS_PER_CELL;

export interface SpatialGrid {
  cols: number;
  rows: number;
  buckets: number[][];
}

export function createGrid(widthLeptons: number, heightLeptons: number): SpatialGrid {
  const cols = Math.max(1, Math.ceil(widthLeptons / BUCKET_LEPTONS));
  const rows = Math.max(1, Math.ceil(heightLeptons / BUCKET_LEPTONS));
  const buckets: number[][] = new Array(cols * rows);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  return { cols, rows, buckets };
}

export function clearGrid(g: SpatialGrid): void {
  for (const b of g.buckets) b.length = 0;
}

function bucketIndex(g: SpatialGrid, x: number, y: number): number {
  const bx = Math.min(g.cols - 1, Math.max(0, Math.floor(x / BUCKET_LEPTONS)));
  const by = Math.min(g.rows - 1, Math.max(0, Math.floor(y / BUCKET_LEPTONS)));
  return by * g.cols + bx;
}

export function insert(g: SpatialGrid, id: number, x: number, y: number): void {
  (g.buckets[bucketIndex(g, x, y)] as number[]).push(id);
}

/** Visit every id whose bucket intersects the circle (coarse; caller refines). */
export function queryCircle(g: SpatialGrid, x: number, y: number, r: number, out: number[]): number[] {
  out.length = 0;
  const bx0 = Math.max(0, Math.floor((x - r) / BUCKET_LEPTONS));
  const by0 = Math.max(0, Math.floor((y - r) / BUCKET_LEPTONS));
  const bx1 = Math.min(g.cols - 1, Math.floor((x + r) / BUCKET_LEPTONS));
  const by1 = Math.min(g.rows - 1, Math.floor((y + r) / BUCKET_LEPTONS));
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const b = g.buckets[by * g.cols + bx] as number[];
      for (let i = 0; i < b.length; i++) out.push(b[i] as number);
    }
  }
  return out;
}
