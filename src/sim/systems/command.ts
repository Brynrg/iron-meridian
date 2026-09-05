// Applies player/AI commands to actors and queues. The only entry point by
// which anything outside the sim changes it.

import { LEPTONS_PER_CELL, cellsToLeptons, tileToWorldCenter, worldToTile } from "../coords";
import { nextInt } from "../rng";
import { buildableTypes, canPlace, deployMcv, emit, findExitCell, getActor, isAlly, spawnStructure, spawnUnit, spend, structDef, unitDef } from "../state";
import { isPassable } from "../map";
import type { Actor, Command, Order, SimState } from "../types";

export function runCommands(state: SimState, commands: Command[]): void {
  for (const c of commands) {
    const player = state.players[c.player];
    if (!player || player.defeated) continue;
    switch (c.kind) {
      case "move":
        groupOrder(state, c.player, c.actors, c.x, c.y, c.queue, (x, y) => ({ kind: "move", x, y }));
        break;
      case "attackMove":
        groupOrder(state, c.player, c.actors, c.x, c.y, c.queue, (x, y) => ({ kind: "attackMove", x, y }));
        break;
      case "attack": {
        const t = getActor(state, c.target);
        if (!t) break;
        for (const a of owned(state, c.player, c.actors)) {
          if (a.kind === "structure") continue;
          const def = unitDef(state, a.type);
          if (def?.engineer && t.kind === "structure" && !isAlly(state, a.owner, t.owner)) setOrder(a, { kind: "capture", target: t.id }, c.queue);
          else if (def?.engineer && t.kind === "structure" && isAlly(state, a.owner, t.owner) && t.hp < t.maxHp) setOrder(a, { kind: "repairUnit", target: t.id }, c.queue);
          else if (def?.c4 && t.kind === "structure") setOrder(a, { kind: "sabotage", target: t.id }, c.queue);
          else if ((def?.spy || def?.thief) && t.kind === "structure") setOrder(a, { kind: "infiltrate", target: t.id }, c.queue);
          else if ((def?.medic || def?.mechanic) && isAlly(state, a.owner, t.owner)) setOrder(a, { kind: "attack", target: t.id }, c.queue);
          else if (t.kind === "structure" && isAlly(state, a.owner, t.owner)) {
            const sd = structDef(state, t.type);
            if (sd?.produces.includes("ship") || sd?.helipad || sd?.repairs) setOrder(a, { kind: "enter", target: t.id }, c.queue);
          } else if (t.kind === "unit" && isAlly(state, a.owner, t.owner) && (unitDef(state, t.type)?.cargo ?? 0) > 0) setOrder(a, { kind: "enter", target: t.id }, c.queue);
          else setOrder(a, { kind: "attack", target: t.id }, c.queue);
        }
        break;
      }
      case "forceMove":
        groupOrder(state, c.player, c.actors, c.x, c.y, c.queue, (x, y) => ({ kind: "forceMove", x, y }));
        break;
      case "phaseJump": {
        const a = getActor(state, c.actor);
        const def = a ? unitDef(state, a.type) : undefined;
        if (!a || !def || def.phaseJump <= 0 || a.owner !== c.player || state.tick < a.revealedUntil) break;
        if (Math.hypot(c.x - a.x, c.y - a.y) > cellsToLeptons(def.phaseJump)) break;
        const tx = worldToTile(c.x);
        const ty = worldToTile(c.y);
        if (!isPassable(state.map, tx, ty, a.loco)) break;
        emit(state, { kind: "explosion", x: a.x, y: a.y, size: 1, tick: state.tick });
        a.x = tileToWorldCenter(tx);
        a.y = tileToWorldCenter(ty);
        a.path = null;
        a.moveGoal = null;
        a.order = { kind: "idle" };
        a.revealedUntil = state.tick + 20 * 30; // recharge: 30 s before the next jump
        emit(state, { kind: "explosion", x: a.x, y: a.y, size: 1, tick: state.tick });
        emit(state, { kind: "eva", cue: "phaseShift", player: c.player });
        break;
      }
      case "placeWall": {
        const sdef = structDef(state, c.type);
        if (!sdef || !(sdef.wall || sdef.gate)) break;
        if (!buildableTypes(state, c.player, "defense").includes(c.type)) break;
        let placed = 0;
        for (const [tx, ty] of c.cells.slice(0, 40)) {
          if (player.credits < sdef.cost) break;
          if (!canPlace(state, c.player, c.type, tx, ty)) continue;
          spend(player, sdef.cost);
          spawnStructure(state, c.type, c.player, tx, ty, 0.5);
          placed++;
        }
        if (placed === 0) emit(state, { kind: "eva", cue: player.credits < sdef.cost ? "insufficientFunds" : "cannotPlace", player: c.player });
        break;
      }
      case "force":
        for (const a of owned(state, c.player, c.actors)) {
          if (a.kind !== "unit") continue;
          a.moveGoal = null;
          a.path = null;
          setOrder(a, { kind: "attackMove", x: c.x, y: c.y }, false);
          a.target = -1;
        }
        break;
      case "stop":
        for (const a of owned(state, c.player, c.actors)) {
          a.order = { kind: "idle" };
          a.queuedOrders = [];
          a.moveGoal = null;
          a.path = null;
          a.target = -1;
          if (a.harvester) a.harvester.state = "idle";
        }
        break;
      case "guard":
        for (const a of owned(state, c.player, c.actors)) {
          if (a.kind !== "unit") continue;
          a.order = { kind: "guard" };
          a.guardX = a.x;
          a.guardY = a.y;
          a.moveGoal = null;
          a.path = null;
        }
        break;
      case "scatter":
        for (const a of owned(state, c.player, c.actors)) {
          if (a.kind !== "unit") continue;
          const dx = (nextInt(state.rng, 5) - 2) * LEPTONS_PER_CELL;
          const dy = (nextInt(state.rng, 5) - 2) * LEPTONS_PER_CELL;
          setOrder(a, { kind: "move", x: a.x + dx, y: a.y + dy }, false);
        }
        break;
      case "deploy":
        for (const a of owned(state, c.player, c.actors)) {
          if (a.kind !== "unit") continue;
          const def = unitDef(state, a.type);
          if (def?.deploysTo) {
            if (!deployMcv(state, a)) emit(state, { kind: "eva", cue: "cannotDeploy", player: c.player });
          } else if (def?.minelayer && a.ammo > 0) {
            const tx = worldToTile(a.x);
            const ty = worldToTile(a.y);
            const occupied = state.actorList.some((s) => s.kind === "structure" && s.tx === tx && s.ty === ty);
            if (!occupied) {
              spawnStructure(state, "mine", a.owner, tx, ty, 1);
              a.ammo--;
              emit(state, { kind: "sfx", name: "click", x: a.x, y: a.y, player: a.owner });
            }
          }
        }
        break;
      case "harvest":
        for (const a of owned(state, c.player, c.actors)) {
          if (!a.harvester) continue;
          a.harvester.state = "idle";
          a.harvester.fieldX = c.tx;
          a.harvester.fieldY = c.ty;
          setOrder(a, { kind: "harvest", tx: c.tx, ty: c.ty }, false);
        }
        break;
      case "stance":
        for (const a of owned(state, c.player, c.actors)) a.stance = c.stance;
        break;
      case "enter": {
        const t = getActor(state, c.target);
        if (!t) break;
        for (const a of owned(state, c.player, c.actors)) if (a.kind === "unit") setOrder(a, { kind: "enter", target: t.id }, false);
        break;
      }
      case "unload":
        for (const a of owned(state, c.player, c.actors)) unloadCargo(state, a);
        break;
      case "queue": {
        if (!buildableTypes(state, c.player, c.queue).includes(c.type)) break;
        const q = player.queues[c.queue];
        if ((c.queue === "building" || c.queue === "defense") && q.items.length > 0) {
          // One structure at a time per column, like the sidebar; allow re-queue of same type to bump count.
          const first = q.items[0];
          if (first && first.type === c.type && !q.ready) first.count++;
          break;
        }
        const existing = q.items.find((i) => i.type === c.type);
        if (existing) existing.count++;
        else q.items.push({ type: c.type, progress: 0, paid: 0, count: 1 });
        q.hold = false;
        break;
      }
      case "dequeue": {
        const q = player.queues[c.queue];
        const i = q.items.findIndex((it) => it.type === c.type);
        if (i < 0) break;
        const item = q.items[i] as { count: number; paid: number; progress: number };
        if (item.count > 1) {
          item.count--;
          if (i === 0 && q.ready) {
            // cancelling extra copies while one is ready keeps the ready one
          }
        } else {
          if (i === 0) {
            player.credits += item.paid;
            q.ready = false;
          }
          q.items.splice(i, 1);
        }
        emit(state, { kind: "eva", cue: "cancelled", player: c.player });
        break;
      }
      case "hold": {
        const q = player.queues[c.queue];
        q.hold = c.hold;
        emit(state, { kind: "eva", cue: c.hold ? "onHold" : "building", player: c.player });
        break;
      }
      case "place": {
        const sdef = structDef(state, c.type);
        if (!sdef) break;
        const q = player.queues[sdef.queue];
        const first = q.items[0];
        if (!first || first.type !== c.type || !q.ready) break;
        if (!canPlace(state, c.player, c.type, c.tx, c.ty)) {
          emit(state, { kind: "eva", cue: "cannotPlace", player: c.player });
          break;
        }
        pushUnitsOut(state, c.tx, c.ty, sdef.footprint[0], sdef.footprint[1]);
        const s = spawnStructure(state, c.type, c.player, c.tx, c.ty, 0);
        if (sdef.refinery) {
          // A refinery ships with a free Ore Truck (classic behaviour).
          const truck = state.rules.units.oretruck;
          if (truck) {
            const [ex, ey] = findExitCell(state, s, "track");
            const t = spawnUnit(state, "oretruck", c.player, tileToWorldCenter(ex), tileToWorldCenter(ey));
            t.order = { kind: "harvest" };
          }
        }
        first.count--;
        if (first.count <= 0) q.items.shift();
        else {
          first.progress = 0;
          first.paid = 0;
        }
        q.ready = false;
        emit(state, { kind: "placed", actor: s.id, player: c.player });
        emit(state, { kind: "eva", cue: "constructionComplete", player: c.player });
        break;
      }
      case "cancelPlace": {
        const q = player.queues[c.queue];
        const first = q.items[0];
        if (!first || !q.ready) break;
        player.credits += first.paid;
        first.count--;
        if (first.count <= 0) q.items.shift();
        else {
          first.progress = 0;
          first.paid = 0;
        }
        q.ready = false;
        break;
      }
      case "sell": {
        const a = getActor(state, c.actor);
        if (!a || a.kind !== "structure" || a.owner !== c.player) break;
        const sdef = structDef(state, a.type);
        if (!sdef?.sellable) break;
        if (!a.selling) {
          a.selling = true;
          a.sellTimer = 30;
          a.repairing = false;
          emit(state, { kind: "eva", cue: "structureSold", player: c.player });
        }
        break;
      }
      case "repair": {
        const a = getActor(state, c.actor);
        if (!a || a.kind !== "structure" || a.owner !== c.player) break;
        if (a.hp >= a.maxHp) break;
        a.repairing = !a.repairing;
        if (a.repairing) emit(state, { kind: "eva", cue: "repairing", player: c.player });
        break;
      }
      case "setRally": {
        const a = getActor(state, c.actor);
        if (!a || a.kind !== "structure" || a.owner !== c.player) break;
        a.rally = { x: c.x, y: c.y };
        break;
      }
      case "setPrimary": {
        const a = getActor(state, c.actor);
        if (!a || a.kind !== "structure" || a.owner !== c.player) break;
        const sdef = structDef(state, a.type);
        if (!sdef || sdef.produces.length === 0) break;
        for (const o of state.actors.values()) {
          if (o.owner === c.player && o.kind === "structure" && o.primary) {
            const od = structDef(state, o.type);
            if (od && od.produces.some((q) => sdef.produces.includes(q))) o.primary = false;
          }
        }
        a.primary = true;
        emit(state, { kind: "eva", cue: "primaryBuilding", player: c.player });
        break;
      }
      case "superweapon":
        fireSuperweapon(state, c.player, c.power, c.x, c.y, c.actors);
        break;
      case "surrender":
        player.defeated = true;
        break;
    }
  }
}

function owned(state: SimState, player: number, ids: number[]): Actor[] {
  const out: Actor[] = [];
  for (const id of ids) {
    const a = getActor(state, id);
    if (a && a.owner === player && a.inside < 0) out.push(a);
  }
  out.sort((x, y) => x.id - y.id);
  return out;
}

function setOrder(a: Actor, o: Order, queue: boolean): void {
  if (queue && a.order.kind !== "idle") {
    a.queuedOrders.push(o);
    return;
  }
  a.order = o;
  a.queuedOrders = [];
  a.path = null;
  a.moveGoal = null;
  a.target = -1;
  if (a.harvester && o.kind !== "harvest") a.harvester.state = "idle";
}

/** Spread a group over a loose grid around the click so units do not pile onto one cell. */
function groupOrder(state: SimState, player: number, ids: number[], x: number, y: number, queue: boolean, make: (x: number, y: number) => Order): void {
  const units = owned(state, player, ids).filter((a) => a.kind === "unit");
  if (units.length === 0) return;
  // Formation move: a spread-out group keeps its shape (clamped), so a line stays a line.
  if (units.length > 1) {
    let cx = 0;
    let cy = 0;
    for (const u of units) {
      cx += u.x;
      cy += u.y;
    }
    cx /= units.length;
    cy /= units.length;
    const spread = Math.max(...units.map((u) => Math.hypot(u.x - cx, u.y - cy)));
    const maxSpread = LEPTONS_PER_CELL * 6;
    if (spread > LEPTONS_PER_CELL * 1.5 && spread <= maxSpread) {
      for (const u of units) setOrder(u, make(Math.round(x + (u.x - cx)), Math.round(y + (u.y - cy))), queue);
      return;
    }
  }
  const cols = Math.ceil(Math.sqrt(units.length));
  const spacing = Math.round(LEPTONS_PER_CELL * 0.9);
  const ox = ((cols - 1) * spacing) / 2;
  const rows = Math.ceil(units.length / cols);
  const oy = ((rows - 1) * spacing) / 2;
  units.forEach((a, i) => {
    const gx = x + (i % cols) * spacing - ox;
    const gy = y + Math.floor(i / cols) * spacing - oy;
    setOrder(a, make(units.length === 1 ? x : gx, units.length === 1 ? y : gy), queue);
  });
}

function pushUnitsOut(state: SimState, tx: number, ty: number, w: number, h: number): void {
  for (const a of state.actorList) {
    if (a.kind !== "unit" || a.loco === "air") continue;
    const ux = worldToTile(a.x);
    const uy = worldToTile(a.y);
    if (ux >= tx && ux < tx + w && uy >= ty && uy < ty + h) {
      a.x = tileToWorldCenter(tx - 1);
      a.y = tileToWorldCenter(ty + h);
      a.path = null;
    }
  }
}

export function unloadCargo(state: SimState, a: Actor): void {
  if (a.cargo.length === 0) return;
  let k = 0;
  for (const id of a.cargo) {
    const p = state.actors.get(id);
    if (!p) continue;
    p.inside = -1;
    const ang = (k / a.cargo.length) * Math.PI * 2;
    p.x = Math.round(a.x + Math.cos(ang) * LEPTONS_PER_CELL);
    p.y = Math.round(a.y + Math.sin(ang) * LEPTONS_PER_CELL);
    p.order = { kind: "idle" };
    k++;
  }
  a.cargo = [];
}

function fireSuperweapon(state: SimState, player: number, power: string, x: number, y: number, actors: number[]): void {
  const p = state.players[player];
  if (!p) return;
  const sw = p.superweapons[power];
  if (!sw || !sw.ready) return;
  sw.ready = false;
  sw.charge = 0;
  switch (power) {
    case "nuke": {
      // A projectile that falls from far above the target; blast on arrival.
      const shooter = [...state.actors.values()].find((a) => a.owner === player && a.type === "missilesilo");
      if (!shooter) return;
      const proj = spawnNuke(state, shooter, x, y);
      emit(state, { kind: "eva", cue: "nukeLaunched", player: -1 });
      void proj;
      break;
    }
    case "phase": {
      const units = owned(state, player, actors).filter((a) => a.kind === "unit" && state.rules.units[a.type]?.class === "vehicle").slice(0, 5);
      units.forEach((u, i) => {
        state.phaseReturns.push({ id: u.id, x: u.x, y: u.y, tick: state.tick + 20 * 20 });
        u.x = x + (i % 3) * LEPTONS_PER_CELL - LEPTONS_PER_CELL;
        u.y = y + Math.floor(i / 3) * LEPTONS_PER_CELL;
        u.path = null;
        u.moveGoal = null;
        u.order = { kind: "idle" };
      });
      emit(state, { kind: "explosion", x, y, size: 3, tick: state.tick });
      emit(state, { kind: "eva", cue: "phaseShift", player });
      break;
    }
    case "aegis": {
      const units = owned(state, player, actors).filter((a) => a.kind === "unit" && state.rules.units[a.type]?.class !== "infantry").slice(0, 5);
      for (const u of units) u.charge = 20 * 20; // invulnerability ticks
      emit(state, { kind: "eva", cue: "aegisActive", player });
      break;
    }
    case "recon": {
      const fog = state.fog[player];
      if (!fog) return;
      const m = state.map;
      const cx = worldToTile(x);
      const cy = worldToTile(y);
      const r = 10;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height || dx * dx + dy * dy > r * r) continue;
        fog[ty * m.width + tx] = 1;
      }
      emit(state, { kind: "eva", cue: "reconComplete", player });
      break;
    }
    case "gps": {
      p.gps = true;
      const fog = state.fog[player];
      if (fog) for (let i = 0; i < fog.length; i++) if (fog[i] === 0) fog[i] = 1;
      emit(state, { kind: "eva", cue: "gpsActive", player });
      break;
    }
    case "sonar": {
      for (const a of state.actorList) if (a.kind === "unit" && a.cloaked && !isAlly(state, a.owner, player)) a.revealedUntil = state.tick + 20 * 25;
      emit(state, { kind: "eva", cue: "sonarPulse", player });
      break;
    }
    case "paradrop": {
      for (let i = 0; i < 5; i++) {
        const u = spawnUnit(state, "rifle", player, x + (i - 2) * 128, y + (i % 2) * 128);
        u.order = { kind: "guard" };
      }
      emit(state, { kind: "eva", cue: "reinforcements", player });
      break;
    }
  }
}

function spawnNuke(state: SimState, shooter: Actor, x: number, y: number): Actor {
  const a = spawnUnit(state, "rifle", -1, x, y - cellsToLeptons(30)); // placeholder body, replaced below
  a.kind = "projectile";
  a.type = "nukeBlast";
  a.proj = { weapon: "nukeBlast", source: shooter.id, targetId: -1, tx: x, ty: y, ttl: 200, arcT: 0, arcTotal: 120, sx: x, sy: y - cellsToLeptons(30) };
  a.owner = shooter.owner;
  a.speed = cellsToLeptons(30) / 120;
  return a;
}
