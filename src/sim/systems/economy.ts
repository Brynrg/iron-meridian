// Power, storage, radar state, structure build-up, repair, selling, ore
// regrowth, derrick income, superweapon charging, and unit passive effects.

import { SIM_TICK_RATE } from "../loop";
import { idx, inBounds, ORE_PER_CELL_MAX } from "../map";
import { nextInt } from "../rng";
import { emit, killActor, removeActor, spawnUnit, spend, structDef, unitDef } from "../state";
import type { SimState } from "../types";

export function runEconomy(state: SimState): void {
  const g = state.rules.general;
  // Reset per-player aggregates.
  for (const p of state.players) {
    p.powerSupply = 0;
    p.powerDrain = 0;
    p.storage = 0;
    p.radarActive = false;
  }
  // First pass: aggregates from built structures.
  for (const a of state.actorList) {
    if (a.kind !== "structure" || a.owner < 0) continue;
    const p = state.players[a.owner];
    const def = structDef(state, a.type);
    if (!p || !def) continue;
    if (a.buildup < 1) {
      a.buildup = Math.min(1, a.buildup + 1 / (SIM_TICK_RATE * 2));
      continue;
    }
    if (def.power > 0) {
      const disabledTicks = a.charge < 0 ? -a.charge : 0;
      if (disabledTicks > 0) a.charge++;
      else p.powerSupply += Math.round(def.power * (a.hp / a.maxHp));
    } else p.powerDrain += -def.power;
    p.storage += def.storage;
  }
  // Losing storage (a refinery dies) loses the ore that no longer fits.
  for (const p of state.players) {
    if (p.ore > p.storage) {
      p.credits -= p.ore - p.storage;
      p.ore = p.storage;
    }
  }
  // Second pass: effects that depend on aggregates.
  for (const a of state.actorList) {
    if (a.kind !== "structure") continue;
    const def = structDef(state, a.type);
    if (!def) continue;
    const p = a.owner >= 0 ? state.players[a.owner] : undefined;
    const lowPower = !!p && p.powerDrain > p.powerSupply;
    if (p) {
      a.disabled = (def.needsPower && lowPower) || (def.power > 0 && a.charge < 0);
      if (def.radar && !a.disabled && a.buildup >= 1) p.radarActive = true;
      if (def.superweapon && a.buildup >= 1 && (!def.superweaponFactions || def.superweaponFactions.includes(p.faction))) {
        const sw = (p.superweapons[def.superweapon] ??= { charge: 0, ready: false });
        if (!a.disabled && !sw.ready) {
          sw.charge++;
          if (sw.charge >= def.chargeTime * SIM_TICK_RATE) {
            sw.ready = true;
            emit(state, { kind: "eva", cue: `${def.superweapon}Ready`, player: p.id });
          }
        }
      }
      // Oil derrick: steady trickle to its owner.
      if (a.type === "oilderrick" && state.tick % 40 === 0) p.credits = Math.min(p.storage + 2000, p.credits + 20);
      // Repair.
      if (a.repairing) {
        if (a.hp >= a.maxHp) a.repairing = false;
        else {
          const hpStep = Math.min(a.maxHp - a.hp, g.repairHpPerSecond / SIM_TICK_RATE);
          const cost = (def.cost * g.repairCostFraction * hpStep) / a.maxHp;
          if (p.credits >= cost) {
            spend(p, cost);
            a.hp += hpStep;
          }
        }
      }
      // Selling.
      if (a.selling) {
        a.sellTimer--;
        if (a.sellTimer <= 0) {
          const refund = Math.round(def.cost * g.sellRefund * (a.hp / a.maxHp));
          p.credits += refund;
          // Sold structures disgorge a few of the crew.
          const crew = Math.min(3, Math.floor(def.cost / 500));
          for (let i = 0; i < crew; i++) {
            const u = spawnUnit(state, "rifle", a.owner, a.x + (i - 1) * 100, a.y + a.h * 128 + 60);
            u.order = { kind: "idle" };
          }
          if (a.type === "conyard") {
            const mcv = spawnUnit(state, "mcv", a.owner, a.x, a.y);
            mcv.order = { kind: "idle" };
          }
          removeActor(state, a);
          continue;
        }
      }
    }
  }
  // Unit passives.
  for (const a of state.actorList) {
    if (a.kind !== "unit") continue;
    if (a.charge > 0) a.charge--; // invulnerability countdown
    if (a.prone && state.tick - a.lastDamagedTick > SIM_TICK_RATE * 4) a.prone = false;
    if (a.type === "kolossus" && a.hp < a.maxHp / 2 && state.tick % 10 === 0) a.hp = Math.min(a.maxHp / 2, a.hp + 2);
    // Medic/mechanic passive healing of nearby friendlies handled by combat "heal" weapons.
    // Hospital: owner infantry slowly regenerate.
    const def = unitDef(state, a.type);
    if (def?.class === "infantry" && a.hp < a.maxHp && state.tick % 40 === 0 && ownsHospital(state, a.owner)) a.hp = Math.min(a.maxHp, a.hp + 5);
  }
  // Husks fade.
  for (const a of state.actorList) {
    if (a.kind !== "husk") continue;
    a.huskTtl--;
    if (a.huskTtl <= 0) removeActor(state, a);
  }
  // Ore regrowth.
  if (state.options.oreGrowth && state.tick % (g.oreGrowthSeconds * SIM_TICK_RATE) === 0) growOre(state);
  // Buildings at zero HP are cleaned up by combat; nothing to do here.
  void killActor;
}

function ownsHospital(state: SimState, owner: number): boolean {
  for (const a of state.actorList) if (a.kind === "structure" && a.owner === owner && a.type === "hospital") return true;
  return false;
}

function growOre(state: SimState): void {
  const m = state.map;
  const mines: number[] = [];
  for (let i = 0; i < m.oreMine.length; i++) if (m.oreMine[i]) mines.push(i);
  for (const i of mines) {
    if ((m.ore[i] as number) < ORE_PER_CELL_MAX) m.ore[i] = (m.ore[i] as number) + 1;
    // Spread to a random neighbour that is clear ground.
    const x = i % m.width;
    const y = (i / m.width) | 0;
    const dx = nextInt(state.rng, 3) - 1;
    const dy = nextInt(state.rng, 3) - 1;
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(m, nx, ny)) continue;
    const ni = idx(m, nx, ny);
    const t = m.terrain[ni];
    if ((t === 0 || t === 2) && (m.occupancy[ni] as number) === -1 && (m.ore[ni] as number) < ORE_PER_CELL_MAX / 2) {
      m.ore[ni] = (m.ore[ni] as number) + 1;
      m.gems[ni] = 0;
    }
  }
}
