// Odds and ends that do not belong to one big system: phase-shift returns,
// aircraft rearming, submarine re-cloaking, radar jamming, crate spawning,
// and helipad/airfield capacity.

import { LEPTONS_PER_CELL, cellsToLeptons, tileToWorldCenter, worldToTile } from "../coords";
import { Terrain, idx, inBounds } from "../map";
import { nextInt } from "../rng";
import { emit, isAlly, structDef, unitDef } from "../state";
import type { Actor, CrateKind, SimState } from "../types";
import { nextOrder } from "./movement";

const CRATE_KINDS: CrateKind[] = ["money", "money", "heal", "reveal", "unit", "shroud"];
const MAX_CRATES = 6;
const CRATE_RESPAWN_TICKS = 20 * 90;

export function runSpecial(state: SimState): void {
  phaseReturns(state);
  rearm(state);
  recloak(state);
  jammers(state);
  crates(state);
}

function phaseReturns(state: SimState): void {
  if (state.phaseReturns.length === 0) return;
  const keep: typeof state.phaseReturns = [];
  for (const r of state.phaseReturns) {
    if (state.tick < r.tick) {
      keep.push(r);
      continue;
    }
    const a = state.actors.get(r.id);
    if (a && !a.dead) {
      emit(state, { kind: "explosion", x: a.x, y: a.y, size: 1, tick: state.tick });
      a.x = r.x;
      a.y = r.y;
      a.path = null;
      a.moveGoal = null;
      a.order = { kind: "idle" };
      a.target = -1;
      emit(state, { kind: "explosion", x: a.x, y: a.y, size: 1, tick: state.tick });
    }
  }
  state.phaseReturns = keep;
}

/** Aircraft with a rearm order fly to the nearest friendly pad and refill. */
function rearm(state: SimState): void {
  for (const a of state.actorList) {
    if (a.kind !== "unit" || a.order.kind !== "rearm") continue;
    const def = unitDef(state, a.type);
    if (!def) continue;
    const pad = nearestPad(state, a);
    if (!pad) {
      // Nowhere to land: circle home and wait.
      if (!a.moveGoal && state.tick % 40 === 0) emit(state, { kind: "eva", cue: "noRearmPad", player: a.owner });
      continue;
    }
    const d = Math.hypot(pad.x - a.x, pad.y - a.y);
    if (d > LEPTONS_PER_CELL * 0.5) {
      if (!a.moveGoal || Math.hypot(a.moveGoal.x - pad.x, a.moveGoal.y - pad.y) > 8) {
        a.moveGoal = { x: pad.x, y: pad.y };
        a.path = null;
      }
      continue;
    }
    a.moveGoal = null;
    // Reload one round every few ticks, repair a little too.
    if (state.tick % 4 === 0) {
      a.ammo = Math.min(def.ammo, a.ammo + 1);
      a.hp = Math.min(a.maxHp, a.hp + 2);
    }
    if (a.ammo >= def.ammo) {
      nextOrder(a);
      const o = a.order as { kind: string };
      if (o.kind === "idle") a.order = { kind: "guard" };
      a.guardX = a.x;
      a.guardY = a.y;
      emit(state, { kind: "sfx", name: "ready", x: a.x, y: a.y, player: a.owner });
    }
  }
}

function nearestPad(state: SimState, a: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const s of state.actorList) {
    if (s.kind !== "structure" || s.buildup < 1 || !isAlly(state, s.owner, a.owner)) continue;
    const sd = structDef(state, s.type);
    if (!sd?.helipad) continue;
    const d = Math.hypot(s.x - a.x, s.y - a.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Submarines and camouflaged things hide again a few seconds after firing. */
function recloak(state: SimState): void {
  for (const a of state.actorList) {
    const def = a.kind === "unit" ? unitDef(state, a.type) : undefined;
    const canCloak = def ? def.cloaked : a.kind === "structure" && a.type === "camopillbox";
    if (!canCloak || a.cloaked) continue;
    if (state.tick - a.lastFiredTick > 20 * 5 && state.tick >= a.revealedUntil) a.cloaked = true;
  }
}

/** Mobile radar jammers switch off enemy radar domes within range. */
function jammers(state: SimState): void {
  const jam: Array<{ x: number; y: number; r: number; owner: number }> = [];
  for (const a of state.actorList) {
    if (a.kind !== "unit") continue;
    const def = unitDef(state, a.type);
    if (def && def.jammer > 0) jam.push({ x: a.x, y: a.y, r: cellsToLeptons(def.jammer), owner: a.owner });
  }
  if (jam.length === 0) return;
  for (const s of state.actorList) {
    if (s.kind !== "structure") continue;
    const sd = structDef(state, s.type);
    if (!sd?.radar) continue;
    for (const j of jam) {
      if (isAlly(state, j.owner, s.owner)) continue;
      if (Math.hypot(j.x - s.x, j.y - s.y) <= j.r) {
        s.disabled = true;
        const p = state.players[s.owner];
        if (p) p.radarActive = false;
        break;
      }
    }
  }
}

/** Crates appear on open ground when the option is on; picked up in movement. */
function crates(state: SimState): void {
  if (!state.options.crates) return;
  const due = state.tick === 20 * 15 || state.tick % CRATE_RESPAWN_TICKS === 0;
  if (!due || state.crates.length >= MAX_CRATES) return;
  const m = state.map;
  for (let attempt = 0; attempt < 40; attempt++) {
    const tx = 2 + nextInt(state.rng, m.width - 4);
    const ty = 2 + nextInt(state.rng, m.height - 4);
    if (!inBounds(m, tx, ty)) continue;
    const i = idx(m, tx, ty);
    const t = m.terrain[i] as Terrain;
    if ((t !== Terrain.Clear && t !== Terrain.Road && t !== Terrain.Rough) || (m.occupancy[i] as number) !== -1 || (m.ore[i] as number) > 0) continue;
    if (state.crates.some((c) => c.tx === tx && c.ty === ty)) continue;
    // Not on top of a start position.
    if (m.starts.some((s) => Math.hypot(s.x - tx, s.y - ty) < 6)) continue;
    state.crates.push({ tx, ty, kind: CRATE_KINDS[nextInt(state.rng, CRATE_KINDS.length)] as CrateKind });
    break;
  }
}

/** Place neutral structures on a fresh skirmish map: derricks, a hospital, civilian buildings. */
export function seedNeutrals(state: SimState, spawn: (type: string, tx: number, ty: number) => void): void {
  const m = state.map;
  const wanted: Array<[string, number]> = [
    ["oilderrick", 2 + Math.floor(m.width / 32)],
    ["hospital", 1],
    ["civ1", 2],
    ["civ2", 1],
  ];
  for (const [type, count] of wanted) {
    const def = state.rules.structures[type];
    if (!def) continue;
    const [w, h] = def.footprint;
    let placed = 0;
    for (let attempt = 0; attempt < 200 && placed < count; attempt++) {
      const tx = 3 + nextInt(state.rng, m.width - 6 - w);
      const ty = 3 + nextInt(state.rng, m.height - 6 - h);
      if (m.starts.some((s) => Math.hypot(s.x - tx, s.y - ty) < 12)) continue;
      let ok = true;
      for (let y = ty - 1; y <= ty + h && ok; y++) {
        for (let x = tx - 1; x <= tx + w; x++) {
          if (!inBounds(m, x, y)) {
            ok = false;
            break;
          }
          const i = idx(m, x, y);
          const t = m.terrain[i] as Terrain;
          if ((t !== Terrain.Clear && t !== Terrain.Rough && t !== Terrain.Road) || (m.occupancy[i] as number) !== -1 || (m.ore[i] as number) > 0) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      spawn(type, tx, ty);
      placed++;
    }
  }
}

export function worldCenter(tx: number, ty: number): [number, number] {
  return [tileToWorldCenter(tx), tileToWorldCenter(ty)];
}

export { worldToTile };
