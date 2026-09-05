// Ore truck state machine: find ore -> drive -> harvest bales -> return to a
// refinery -> unload into credits (bounded by storage) -> repeat.

import { LEPTONS_PER_CELL, tileToWorldCenter, worldToTile } from "../coords";
import { idx, inBounds } from "../map";
import { emit, unitDef } from "../state";
import type { Actor, SimState } from "../types";

export function runHarvest(state: SimState): void {
  const g = state.rules.general;
  for (const a of state.actorList) {
    if (a.kind !== "unit" || !a.harvester) continue;
    const def = unitDef(state, a.type);
    if (!def?.harvester) continue;
    const h = a.harvester;
    if (a.order.kind !== "harvest" && a.order.kind !== "returnCargo") {
      // Idle trucks go back to work on their own.
      if (a.order.kind === "idle" && a.moveGoal === null) a.order = h.cargo + h.gems > 0 ? { kind: "returnCargo" } : { kind: "harvest" };
      else continue;
    }
    const cap = def.harvester.capacity;
    const load = h.cargo + h.gems;
    switch (h.state) {
      case "idle": {
        if (a.order.kind === "returnCargo" || load >= cap) {
          h.state = "toRefinery";
          break;
        }
        const pref = a.order.kind === "harvest" && a.order.tx !== undefined ? [a.order.tx, a.order.ty as number] : h.fieldX >= 0 ? [h.fieldX, h.fieldY] : null;
        const cell = findOre(state, pref ? tileToWorldCenter(pref[0] as number) : a.x, pref ? tileToWorldCenter(pref[1] as number) : a.y, 14) ?? findOre(state, a.x, a.y, 60);
        if (!cell) {
          if (load > 0) h.state = "toRefinery";
          break;
        }
        h.fieldX = cell[0];
        h.fieldY = cell[1];
        a.moveGoal = { x: tileToWorldCenter(cell[0]), y: tileToWorldCenter(cell[1]) };
        a.path = null;
        h.state = "toField";
        break;
      }
      case "toField": {
        const dx = tileToWorldCenter(h.fieldX) - a.x;
        const dy = tileToWorldCenter(h.fieldY) - a.y;
        if (Math.hypot(dx, dy) <= LEPTONS_PER_CELL * 0.6) {
          a.moveGoal = null;
          a.path = null;
          h.state = "harvesting";
        } else if (!a.moveGoal) {
          // Movement gave up (unreachable): pick another field.
          h.fieldX = -1;
          h.state = "idle";
        }
        break;
      }
      case "harvesting": {
        const m = state.map;
        const tx = worldToTile(a.x);
        const ty = worldToTile(a.y);
        const i = inBounds(m, tx, ty) ? idx(m, tx, ty) : -1;
        if (i < 0 || (m.ore[i] as number) <= 0) {
          const near = findOre(state, a.x, a.y, 3);
          if (near && load < cap) {
            h.fieldX = near[0];
            h.fieldY = near[1];
            a.moveGoal = { x: tileToWorldCenter(near[0]), y: tileToWorldCenter(near[1]) };
            a.path = null;
            h.state = "toField";
          } else h.state = load > 0 ? "toRefinery" : "idle";
          break;
        }
        if (load >= cap) {
          h.state = "toRefinery";
          break;
        }
        if ((state.tick + a.id) % g.harvestTicksPerBale === 0) {
          m.ore[i] = (m.ore[i] as number) - 1;
          if (m.gems[i]) h.gems++;
          else h.cargo++;
          a.facing = (a.facing + 1) % 32; // idle wobble while harvesting
        }
        break;
      }
      case "toRefinery": {
        const ref = nearestRefinery(state, a);
        if (!ref) {
          a.moveGoal = null;
          if (state.tick % 100 === 0) emit(state, { kind: "eva", cue: "noRefinery", player: a.owner });
          break;
        }
        h.refinery = ref.id;
        const dock = dockPoint(state, ref);
        if (Math.hypot(dock.x - a.x, dock.y - a.y) <= LEPTONS_PER_CELL * 0.7) {
          a.moveGoal = null;
          a.path = null;
          a.x = dock.x;
          a.y = dock.y;
          a.facing = 0;
          h.state = "unloading";
        } else if (!a.moveGoal || Math.hypot(a.moveGoal.x - dock.x, a.moveGoal.y - dock.y) > 8) {
          a.moveGoal = { x: dock.x, y: dock.y };
          a.path = null;
        }
        break;
      }
      case "unloading": {
        const p = state.players[a.owner];
        const ref = state.actors.get(h.refinery);
        if (!p || !ref || ref.dead || ref.owner !== a.owner) {
          h.state = "idle";
          break;
        }
        if (load === 0) {
          h.state = "idle";
          a.order = { kind: "harvest" };
          break;
        }
        if ((state.tick + a.id) % g.unloadTicksPerBale !== 0) break;
        if (p.ore >= p.storage) {
          if (state.tick % 120 === 0) emit(state, { kind: "eva", cue: "silosNeeded", player: a.owner });
          break;
        }
        const value = h.gems > 0 ? g.gemValue : g.oreValue;
        if (h.gems > 0) h.gems--;
        else h.cargo--;
        const room = Math.min(value, p.storage - p.ore);
        p.ore += room;
        p.credits += room;
        p.stats.harvested += room;
        break;
      }
    }
  }
}

/** Nearest ore-bearing cell within `r` cells of a world point, or null. */
export function findOre(state: SimState, x: number, y: number, r: number): [number, number] | null {
  const m = state.map;
  const cx = worldToTile(x);
  const cy = worldToTile(y);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (!inBounds(m, tx, ty)) continue;
      const i = idx(m, tx, ty);
      if ((m.ore[i] as number) <= 0) continue;
      if ((m.occupancy[i] as number) !== -1) continue;
      const d = dx * dx + dy * dy - (m.gems[i] ? 4 : 0);
      if (d < bestD) {
        bestD = d;
        best = [tx, ty];
      }
    }
  }
  return best;
}

export function nearestRefinery(state: SimState, a: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const s of state.actorList) {
    if (s.kind !== "structure" || s.owner !== a.owner || s.buildup < 1) continue;
    const def = state.rules.structures[s.type];
    if (!def?.refinery) continue;
    const d = Math.hypot(s.x - a.x, s.y - a.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function dockPoint(state: SimState, ref: Actor): { x: number; y: number } {
  const def = state.rules.structures[ref.type];
  const ex = ref.tx + (def?.exit?.[0] ?? 1);
  const ey = ref.ty + (def?.exit?.[1] ?? ref.h);
  return { x: tileToWorldCenter(ex), y: tileToWorldCenter(ey) };
}
