// Procedural skirmish map generator. Deterministic from a seed. Produces
// terrain, ore fields with regrowing mines, a lake, cliffs, tree clumps, and
// symmetric start positions so both players get an equivalent opening.

import { type MapData, Terrain, createMap, idx, inBounds, ORE_PER_CELL_MAX } from "./map";
import { createRng, nextFloat, nextInt } from "./rng";

export interface MapGenOptions {
  seed: number;
  width: number;
  height: number;
  players: number; // 2..4
  waterAmount: number; // 0..1
  oreAmount: number; // 0..1
}

// Value noise: smooth, seeded, cheap.
function makeNoise(seed: number, freq: number, w: number, h: number): Float32Array {
  const rng = createRng(seed);
  const gw = Math.ceil(w / freq) + 2;
  const gh = Math.ceil(h / freq) + 2;
  const lattice = new Float32Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = nextFloat(rng);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / freq;
      const gy = y / freq;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const a = lattice[y0 * gw + x0] as number;
      const b = lattice[y0 * gw + x0 + 1] as number;
      const c = lattice[(y0 + 1) * gw + x0] as number;
      const d = lattice[(y0 + 1) * gw + x0 + 1] as number;
      out[y * w + x] = lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function generateMap(opts: MapGenOptions): MapData {
  const { width: w, height: h } = opts;
  const m = createMap(`Skirmish ${opts.seed.toString(16)}`, w, h);
  const rng = createRng(opts.seed ^ 0x9e3779b9);
  const n1 = makeNoise(opts.seed + 1, 9, w, h);
  const n2 = makeNoise(opts.seed + 2, 4, w, h);
  const n3 = makeNoise(opts.seed + 3, 17, w, h);

  // Start positions: symmetric corners with margin.
  const margin = Math.max(6, Math.floor(Math.min(w, h) * 0.14));
  const corners: Array<[number, number]> = [
    [margin, margin],
    [w - 1 - margin, h - 1 - margin],
    [w - 1 - margin, margin],
    [margin, h - 1 - margin],
  ];
  m.starts = corners.slice(0, Math.max(2, Math.min(4, opts.players))).map(([x, y]) => ({ x, y }));

  const clearRadius = 9; // keep bases buildable
  // Water threshold from the noise distribution so `waterAmount` maps to coverage
  // (0 -> none, 1 -> ~35% of cells) instead of depending on the noise's spread.
  const sortedN3 = Array.from(n3).sort((a, b) => a - b);
  const waterFrac = Math.max(0, Math.min(0.35, opts.waterAmount * 0.35));
  const waterCut = waterFrac > 0 ? (sortedN3[Math.floor(waterFrac * (sortedN3.length - 1))] as number) : -1;
  const beachCut = waterFrac > 0 ? (sortedN3[Math.min(sortedN3.length - 1, Math.floor((waterFrac + 0.03) * (sortedN3.length - 1)))] as number) : -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(m, x, y);
      const a = n1[i] as number;
      const b = n2[i] as number;
      const c = n3[i] as number;
      let t: Terrain = Terrain.Clear;
      const nearStart = m.starts.some((s) => Math.hypot(s.x - x, s.y - y) < clearRadius);
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (edge) t = Terrain.Cliff;
      else if (!nearStart) {
        // Central lake / rivers from low-frequency noise.
        if (c <= waterCut) t = Terrain.Water;
        else if (c <= beachCut) t = Terrain.Beach;
        else if (a > 0.78) t = Terrain.Cliff;
        else if (a > 0.72) t = Terrain.Rock;
        else if (b > 0.74 && a < 0.5) t = Terrain.Tree;
        else if (b < 0.2) t = Terrain.Rough;
      }
      m.terrain[i] = t;
    }
  }

  // Make water bodies coherent: remove single-cell puddles, add beach rings.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = idx(m, x, y);
      if (m.terrain[i] === Terrain.Water) {
        let waterN = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.terrain[idx(m, x + dx, y + dy)] === Terrain.Water) waterN++;
        if (waterN <= 3) m.terrain[i] = Terrain.Beach;
      }
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = idx(m, x, y);
      if (m.terrain[i] === Terrain.Clear || m.terrain[i] === Terrain.Rough) {
        let nearWater = false;
        for (let dy = -1; dy <= 1 && !nearWater; dy++) for (let dx = -1; dx <= 1; dx++) if (m.terrain[idx(m, x + dx, y + dy)] === Terrain.Water) nearWater = true;
        if (nearWater) m.terrain[i] = Terrain.Beach;
      }
    }
  }

  // Roads between starts (straight-ish lines) for flavour and faster movement.
  for (let s = 0; s < m.starts.length; s++) {
    const a = m.starts[s] as { x: number; y: number };
    const b = m.starts[(s + 1) % m.starts.length] as { x: number; y: number };
    const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * k) / steps);
      const i = idx(m, x, y);
      const t = m.terrain[i];
      if (t === Terrain.Clear || t === Terrain.Rough || t === Terrain.Tree || t === Terrain.Rock) m.terrain[i] = Terrain.Road;
      else if (t === Terrain.Water || t === Terrain.Beach) m.terrain[i] = Terrain.Bridge;
    }
  }

  // Ore: one rich field near each start, several contested fields elsewhere.
  const fields: Array<[number, number, number, boolean]> = [];
  for (const s of m.starts) {
    const ang = nextFloat(rng) * Math.PI * 2;
    const r = 7 + nextInt(rng, 3);
    fields.push([Math.round(s.x + Math.cos(ang) * r), Math.round(s.y + Math.sin(ang) * r), 4, false]);
  }
  const extra = 2 + Math.round(opts.oreAmount * 6);
  for (let k = 0; k < extra; k++) {
    const x = 6 + nextInt(rng, w - 12);
    const y = 6 + nextInt(rng, h - 12);
    const gems = nextFloat(rng) < 0.25;
    fields.push([x, y, 3 + nextInt(rng, 3), gems]);
  }
  for (const [fx, fy, fr, gems] of fields) {
    for (let dy = -fr; dy <= fr; dy++) {
      for (let dx = -fr; dx <= fr; dx++) {
        const x = fx + dx;
        const y = fy + dy;
        if (!inBounds(m, x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d > fr) continue;
        const i = idx(m, x, y);
        const t = m.terrain[i];
        if (t !== Terrain.Clear && t !== Terrain.Rough && t !== Terrain.Road) continue;
        const dens = 1 - d / (fr + 0.5);
        if (nextFloat(rng) > dens + 0.15) continue;
        m.ore[i] = Math.max(2, Math.round(dens * ORE_PER_CELL_MAX));
        m.gems[i] = gems ? 1 : 0;
        if (!gems && d <= 1.5) m.oreMine[i] = 1;
        if (m.terrain[i] === Terrain.Road) m.terrain[i] = Terrain.Clear;
      }
    }
  }
  // Clear ore from the exact start footprints so the MCV can deploy.
  for (const s of m.starts) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (inBounds(m, s.x + dx, s.y + dy)) {
        const i = idx(m, s.x + dx, s.y + dy);
        m.ore[i] = 0;
        m.oreMine[i] = 0;
        if (m.terrain[i] !== Terrain.Road) m.terrain[i] = Terrain.Clear;
      }
    }
  }
  return m;
}
