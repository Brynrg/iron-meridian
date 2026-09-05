// Shroud and fog. Per player: 0 = never seen, 1 = seen (stale), 2 = visible.
// Visible cells decay to 1 each recompute; every own/allied actor then stamps
// its sight radius. Gap generators re-shroud enemy visibility around them.

import { worldToTile } from "../coords";
import { idx, inBounds } from "../map";
import { isAlly } from "../state";
import type { SimState } from "../types";

export const FOG_INTERVAL = 4; // ticks

export function runFog(state: SimState): void {
  if (state.tick % FOG_INTERVAL !== 0) return;
  const m = state.map;
  for (let p = 0; p < state.players.length; p++) {
    const fog = state.fog[p] as Uint8Array;
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
  }
  for (const a of state.actorList) {
    if (a.kind !== "unit" && a.kind !== "structure") continue;
    if (a.owner < 0 || a.inside >= 0) continue;
    const def = a.kind === "unit" ? state.rules.units[a.type] : state.rules.structures[a.type];
    if (!def) continue;
    let sight = def.sight;
    if (a.kind === "structure" && a.disabled && (def as { radar?: boolean }).radar) sight = 4;
    const cx = worldToTile(a.x);
    const cy = worldToTile(a.y);
    for (let p = 0; p < state.players.length; p++) {
      if (!isAlly(state, p, a.owner)) continue;
      const fog = state.fog[p] as Uint8Array;
      stamp(fog, m.width, m.height, cx, cy, sight, 2);
    }
  }
  // Gap generators: enemies lose vision (set back to explored) around them.
  for (const a of state.actorList) {
    const def = a.kind === "unit" ? state.rules.units[a.type] : a.kind === "structure" ? state.rules.structures[a.type] : undefined;
    const gap = def?.gap ?? 0;
    if (gap <= 0 || a.disabled) continue;
    const cx = worldToTile(a.x);
    const cy = worldToTile(a.y);
    for (let p = 0; p < state.players.length; p++) {
      if (isAlly(state, p, a.owner)) continue;
      const fog = state.fog[p] as Uint8Array;
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          if (dx * dx + dy * dy > gap * gap) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!inBounds(m, x, y)) continue;
          const i = idx(m, x, y);
          if (fog[i] === 2) fog[i] = 1;
        }
      }
    }
  }
}

function stamp(fog: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, v: number): void {
  const r2 = (r + 0.5) * (r + 0.5);
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      if (dx * dx + dy * dy > r2) continue;
      fog[y * w + x] = v;
    }
  }
}

export function isVisibleTo(state: SimState, player: number, x: number, y: number): boolean {
  const m = state.map;
  const tx = worldToTile(x);
  const ty = worldToTile(y);
  if (!inBounds(m, tx, ty)) return false;
  return (state.fog[player] as Uint8Array)[idx(m, tx, ty)] === 2;
}

export function revealAll(state: SimState, player: number): void {
  const fog = state.fog[player];
  if (fog) fog.fill(1);
}
