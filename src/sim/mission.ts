// Campaign mission engine: data-driven objectives and triggers evaluated
// inside the sim so missions are deterministic, saveable, and replayable.

import { LEPTONS_PER_CELL, cellsToLeptons, tileToWorldCenter, worldToTile } from "./coords";
import { emit, removeActor, spawnStructure, spawnUnit, structDef, unitDef } from "./state";
import type { FactionId, QueueKind } from "../data/schemas";
import type { Command, GameOptions, SimState } from "./types";
import type { PlayerSetup } from "./state";
import { idx, inBounds, isBuildable } from "./map";

export interface Area {
  tx: number;
  ty: number;
  r: number;
}

export type Objective = {
  id: string;
  text: string;
  optional?: boolean;
  hidden?: boolean; // becomes active via a trigger
} & (
  | { kind: "destroyAll"; owner: number } // every structure + combat unit of a player
  | { kind: "destroyStructures"; owner: number }
  | { kind: "destroyType"; owner: number; type: string; count?: number }
  | { kind: "captureType"; type: string; count?: number }
  | { kind: "buildType"; type: string; count?: number }
  | { kind: "reach"; area: Area; type?: string; count?: number }
  | { kind: "survive"; seconds: number }
  | { kind: "protect"; type: string; owner?: number } // fails if all such actors die
  | { kind: "credits"; amount: number }
  | { kind: "killCount"; count: number }
  | { kind: "flag" } // completed only by a trigger action
);

export type TriggerWhen =
  | { kind: "time"; seconds: number }
  | { kind: "objectiveDone"; id: string }
  | { kind: "unitEnters"; area: Area; owner: number; type?: string }
  | { kind: "destroyed"; owner: number; type?: string; count?: number }
  | { kind: "lowHp"; owner: number; type: string; frac: number }
  | { kind: "built"; owner: number; type: string }
  | { kind: "discovered"; owner: number; type: string; by: number } // structure seen by player
  | { kind: "start" };

export type TriggerAction =
  | { kind: "message"; text: string }
  | { kind: "eva"; cue: string }
  | { kind: "reinforce"; owner: number; units: Array<{ type: string; count: number }>; tx: number; ty: number; order?: "guard" | "attackMove" | "hunt" | "move"; toTx?: number; toTy?: number }
  | { kind: "spawnStructure"; owner: number; type: string; tx: number; ty: number }
  | { kind: "reveal"; owner: number; tx: number; ty: number; r: number }
  | { kind: "activate"; id: string }
  | { kind: "complete"; id: string }
  | { kind: "fail"; id?: string }
  | { kind: "win" }
  | { kind: "lose" }
  | { kind: "camera"; tx: number; ty: number }
  | { kind: "timer"; seconds: number; label: string }
  | { kind: "attackWave"; owner: number; from: Area; toTx: number; toTy: number }
  | { kind: "credits"; owner: number; amount: number }
  | { kind: "sell"; owner: number; type: string }
  | { kind: "enableAi"; owner: number; difficulty: "easy" | "normal" | "hard" }
  | { kind: "setOwner"; type: string; from: number; to: number }
  | { kind: "removeUnits"; owner: number; type?: string };

export interface Trigger {
  id: string;
  when: TriggerWhen;
  actions: TriggerAction[];
  repeat?: boolean;
}

export interface MissionDef {
  id: string;
  faction: FactionId;
  act: number;
  index: number;
  title: string;
  briefing: string[];
  map: { pool?: string; gen?: { seed: number; width: number; height: number; waterAmount: number; oreAmount: number } };
  players: Array<PlayerSetup & { credits?: number }>;
  actors: Array<{ type: string; owner: number; tx: number; ty: number; order?: "guard" | "harvest"; count?: number }>;
  options?: Partial<GameOptions>;
  objectives: Objective[];
  triggers: Trigger[];
  noStartingUnits?: boolean; // do not spawn faction starting units
  techLevel?: number;
}

export interface MissionRuntime {
  id: string;
  status: Record<string, "hidden" | "active" | "done" | "failed">;
  fired: string[];
  timerEnd: number; // tick, -1 none
  timerLabel: string;
  startTick: number;
  counters: Record<string, number>;
  cameraTx: number;
  cameraTy: number;
}

export function createMissionRuntime(def: MissionDef, tick: number): MissionRuntime {
  const status: MissionRuntime["status"] = {};
  for (const o of def.objectives) status[o.id] = o.hidden ? "hidden" : "active";
  return { id: def.id, status, fired: [], timerEnd: -1, timerLabel: "", startTick: tick, counters: {}, cameraTx: -1, cameraTy: -1 };
}

/** Spawn the mission's pre-placed actors. Structures are placed at full build-up. */
export function seedMission(state: SimState, def: MissionDef): void {
  for (const a of def.actors) {
    const n = a.count ?? 1;
    for (let k = 0; k < n; k++) {
      if (structDef(state, a.type)) {
        // Nudge scripted structures off water/cliffs/occupied cells so generated terrain never buries them.
        const def = structDef(state, a.type)!;
        const want: [number, number] = [a.tx + (k % 4) * 2, a.ty + Math.floor(k / 4) * 2];
        const spot = findFootprint(state, def.footprint[0], def.footprint[1], want[0], want[1]);
        if (!spot) continue;
        const s = spawnStructure(state, a.type, a.owner, spot[0], spot[1], 1);
        if (a.owner >= 0 && a.type === "conyard") s.primary = false;
      } else if (unitDef(state, a.type)) {
        const u = spawnUnit(state, a.type, a.owner, tileToWorldCenter(a.tx + (k % 5)), tileToWorldCenter(a.ty + Math.floor(k / 5)), 16);
        u.order = a.order === "harvest" ? { kind: "harvest" } : { kind: "guard" };
        u.guardX = u.x;
        u.guardY = u.y;
      }
    }
  }
}

function findFootprint(state: SimState, w: number, h: number, tx: number, ty: number): [number, number] | null {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        let ok = true;
        for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w; xx++) if (!isBuildable(state.map, xx, yy)) { ok = false; break; }
        if (ok) return [x, y];
      }
    }
  }
  return null;
}

function inArea(x: number, y: number, area: Area): boolean {
  return Math.hypot(x - tileToWorldCenter(area.tx), y - tileToWorldCenter(area.ty)) <= cellsToLeptons(area.r);
}

/** Evaluate objectives and triggers for this tick. Returns commands to inject. */
export function runMission(state: SimState, def: MissionDef, rt: MissionRuntime, out: Command[]): void {
  if (state.finished) return;
  const tick = state.tick;
  const secs = (tick - rt.startTick) / 20;
  const human = 0;
  const p0 = state.players[human];
  if (!p0) return;
  // Track kills/captures via counters updated from events emitted last tick.
  for (const ev of state.events) {
    if (ev.kind === "died" && ev.player >= 0 && ev.kind2 !== "projectile") {
      const key = `died:${ev.player}:${ev.type}`;
      rt.counters[key] = (rt.counters[key] ?? 0) + 1;
      const all = `died:${ev.player}:*`;
      rt.counters[all] = (rt.counters[all] ?? 0) + 1;
    }
  }

  // Objectives.
  for (const o of def.objectives) {
    const st = rt.status[o.id];
    if (st !== "active") continue;
    let done = false;
    let failed = false;
    switch (o.kind) {
      case "destroyAll": {
        done = !state.actorList.some((a) => a.owner === o.owner && ((a.kind === "structure" && !structDef(state, a.type)?.wall) || (a.kind === "unit" && (unitDef(state, a.type)?.weapons.length ?? 0) > 0)));
        break;
      }
      case "destroyStructures":
        done = !state.actorList.some((a) => a.owner === o.owner && a.kind === "structure" && !structDef(state, a.type)?.wall && !structDef(state, a.type)?.mine);
        break;
      case "destroyType": {
        const alive = state.actorList.filter((a) => a.owner === o.owner && a.type === o.type).length;
        const killed = rt.counters[`died:${o.owner}:${o.type}`] ?? 0;
        done = o.count ? killed >= o.count : alive === 0 && killed > 0;
        break;
      }
      case "captureType":
        done = state.actorList.filter((a) => a.owner === human && a.type === o.type && a.kind === "structure").length >= (o.count ?? 1);
        break;
      case "buildType":
        done = state.actorList.filter((a) => a.owner === human && a.type === o.type && (a.kind === "structure" ? a.buildup >= 1 : true)).length >= (o.count ?? 1);
        break;
      case "reach": {
        const n = state.actorList.filter((a) => a.owner === human && a.kind === "unit" && (!o.type || a.type === o.type) && inArea(a.x, a.y, o.area)).length;
        done = n >= (o.count ?? 1);
        break;
      }
      case "survive":
        done = secs >= o.seconds;
        break;
      case "protect": {
        // Fails only once the protected thing has existed and is now gone.
        const owner = o.owner ?? human;
        const key = `seen:${owner}:${o.type}`;
        const alive = state.actorList.some((a) => a.owner === owner && a.type === o.type);
        if (alive) rt.counters[key] = 1;
        failed = !alive && rt.counters[key] === 1;
        break;
      }
      case "credits":
        done = p0.credits >= o.amount;
        break;
      case "killCount":
        done = p0.stats.kills >= o.count;
        break;
      case "flag":
        break;
    }
    if (failed) {
      rt.status[o.id] = "failed";
      emit(state, { kind: "text", player: human, text: `Objective failed: ${o.text}` });
      if (!o.optional) loseMission(state);
    } else if (done) {
      rt.status[o.id] = "done";
      emit(state, { kind: "text", player: human, text: `Objective complete: ${o.text}` });
      emit(state, { kind: "eva", cue: "objectiveComplete", player: human });
    }
  }

  // Triggers.
  for (const tr of def.triggers) {
    if (rt.fired.includes(tr.id) && !tr.repeat) continue;
    if (!triggerReady(state, def, rt, tr.when, secs)) continue;
    if (!tr.repeat) rt.fired.push(tr.id);
    for (const act of tr.actions) applyAction(state, def, rt, act, out);
  }

  // Mission timer.
  if (rt.timerEnd >= 0 && tick >= rt.timerEnd) {
    rt.timerEnd = -1;
    emit(state, { kind: "text", player: human, text: `${rt.timerLabel}: time expired` });
    // A timer expiring fails any active "survive"-style flag objectives named "timer".
    if (rt.status.timer === "active") {
      rt.status.timer = "failed";
      loseMission(state);
    }
  }

  // Win when every required objective is done and none failed.
  const required = def.objectives.filter((o) => !o.optional);
  if (required.length && required.every((o) => rt.status[o.id] === "done")) winMission(state);
  if (p0.defeated) loseMission(state);
}

function triggerReady(state: SimState, def: MissionDef, rt: MissionRuntime, when: TriggerWhen, secs: number): boolean {
  void def;
  switch (when.kind) {
    case "start":
      return true;
    case "time":
      return secs >= when.seconds;
    case "objectiveDone":
      return rt.status[when.id] === "done";
    case "unitEnters":
      return state.actorList.some((a) => a.owner === when.owner && a.kind === "unit" && (!when.type || a.type === when.type) && inArea(a.x, a.y, when.area));
    case "destroyed": {
      const key = when.type ? `died:${when.owner}:${when.type}` : `died:${when.owner}:*`;
      return (rt.counters[key] ?? 0) >= (when.count ?? 1);
    }
    case "lowHp":
      return state.actorList.some((a) => a.owner === when.owner && a.type === when.type && a.hp <= a.maxHp * when.frac);
    case "built":
      return state.actorList.some((a) => a.owner === when.owner && a.type === when.type && (a.kind !== "structure" || a.buildup >= 1));
    case "discovered": {
      const fog = state.fog[when.by];
      if (!fog) return false;
      const m = state.map;
      return state.actorList.some((a) => {
        if (a.owner !== when.owner || a.type !== when.type) return false;
        const tx = worldToTile(a.x);
        const ty = worldToTile(a.y);
        return inBounds(m, tx, ty) && (fog[idx(m, tx, ty)] as number) >= 1;
      });
    }
  }
}

function applyAction(state: SimState, def: MissionDef, rt: MissionRuntime, act: TriggerAction, out: Command[]): void {
  const human = 0;
  switch (act.kind) {
    case "message":
      emit(state, { kind: "text", player: human, text: act.text });
      break;
    case "eva":
      emit(state, { kind: "eva", cue: act.cue, player: human });
      break;
    case "reinforce": {
      const ids: number[] = [];
      let k = 0;
      for (const u of act.units) {
        for (let i = 0; i < u.count; i++) {
          const x = tileToWorldCenter(act.tx + (k % 5));
          const y = tileToWorldCenter(act.ty + Math.floor(k / 5));
          const a = spawnUnit(state, u.type, act.owner, x, y, 16);
          a.order = { kind: "guard" };
          a.guardX = x;
          a.guardY = y;
          ids.push(a.id);
          k++;
        }
      }
      if (act.order === "attackMove" || act.order === "move") {
        const tx = act.toTx ?? act.tx;
        const ty = act.toTy ?? act.ty;
        out.push({ player: act.owner, kind: act.order, actors: ids, x: tileToWorldCenter(tx), y: tileToWorldCenter(ty), queue: false });
      } else if (act.order === "hunt") {
        const target = state.actorList.find((a) => a.owner === human && a.kind === "structure") ?? state.actorList.find((a) => a.owner === human);
        if (target) out.push({ player: act.owner, kind: "attackMove", actors: ids, x: target.x, y: target.y, queue: false });
      }
      if (act.owner === human) emit(state, { kind: "eva", cue: "reinforcements", player: human });
      break;
    }
    case "spawnStructure":
      spawnStructure(state, act.type, act.owner, act.tx, act.ty, 1);
      break;
    case "reveal": {
      const fog = state.fog[act.owner];
      if (!fog) break;
      const m = state.map;
      for (let dy = -act.r; dy <= act.r; dy++)
        for (let dx = -act.r; dx <= act.r; dx++) {
          const x = act.tx + dx;
          const y = act.ty + dy;
          if (inBounds(m, x, y) && dx * dx + dy * dy <= act.r * act.r && fog[idx(m, x, y)] === 0) fog[idx(m, x, y)] = 1;
        }
      break;
    }
    case "activate":
      if (rt.status[act.id] === "hidden") {
        rt.status[act.id] = "active";
        const o = def.objectives.find((x) => x.id === act.id);
        emit(state, { kind: "text", player: human, text: `New objective: ${o?.text ?? act.id}` });
        emit(state, { kind: "eva", cue: "newObjective", player: human });
      }
      break;
    case "complete":
      if (rt.status[act.id] === "active" || rt.status[act.id] === "hidden") {
        rt.status[act.id] = "done";
        const o = def.objectives.find((x) => x.id === act.id);
        emit(state, { kind: "text", player: human, text: `Objective complete: ${o?.text ?? act.id}` });
      }
      break;
    case "fail":
      if (act.id) rt.status[act.id] = "failed";
      loseMission(state);
      break;
    case "win":
      winMission(state);
      break;
    case "lose":
      loseMission(state);
      break;
    case "camera":
      rt.cameraTx = act.tx;
      rt.cameraTy = act.ty;
      break;
    case "timer":
      rt.timerEnd = state.tick + Math.round(act.seconds * 20);
      rt.timerLabel = act.label;
      emit(state, { kind: "eva", cue: "timerStarted", player: human });
      break;
    case "attackWave": {
      const ids = state.actorList.filter((a) => a.owner === act.owner && a.kind === "unit" && (unitDef(state, a.type)?.weapons.length ?? 0) > 0 && inArea(a.x, a.y, act.from)).map((a) => a.id);
      if (ids.length) out.push({ player: act.owner, kind: "attackMove", actors: ids, x: tileToWorldCenter(act.toTx), y: tileToWorldCenter(act.toTy), queue: false });
      break;
    }
    case "credits": {
      const p = state.players[act.owner];
      if (p) p.credits += act.amount;
      break;
    }
    case "sell":
      for (const a of state.actorList) if (a.owner === act.owner && a.type === act.type && a.kind === "structure") out.push({ player: act.owner, kind: "sell", actor: a.id });
      break;
    case "enableAi": {
      const p = state.players[act.owner];
      if (p && !p.ai) {
        p.isAI = true;
        p.difficulty = act.difficulty;
        p.ai = { phase: 0, nextThinkTick: state.tick + 1, attackWaveAt: 0, rallyX: 0, rallyY: 0, targetX: -1, targetY: -1, attacking: false, lastBaseAttackTick: -100000, buildOrderIdx: 0, failedPlacements: 0, blocked: [], blockedClearTick: 0 };
      }
      break;
    }
    case "setOwner":
      for (const a of state.actorList) if (a.owner === act.from && a.type === act.type) a.owner = act.to;
      break;
    case "removeUnits":
      for (const a of [...state.actorList]) if (a.owner === act.owner && a.kind === "unit" && (!act.type || a.type === act.type)) removeActor(state, a);
      break;
  }
}

function winMission(state: SimState): void {
  if (state.finished) return;
  state.finished = true;
  state.winner = state.players[0]?.team ?? 0;
  emit(state, { kind: "victory", player: 0 });
}

function loseMission(state: SimState): void {
  if (state.finished) return;
  state.finished = true;
  state.winner = -2;
  const p = state.players[0];
  if (p) p.defeated = true;
  emit(state, { kind: "defeat", player: 0 });
}

export function queueKindOf(state: SimState, type: string): QueueKind | null {
  return state.rules.units[type]?.queue ?? state.rules.structures[type]?.queue ?? null;
}

export { LEPTONS_PER_CELL };
