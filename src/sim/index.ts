// Tick orchestrator. Pinned system order; the state hash is computed at the
// end of every tick so replays and peers can compare.

import { clearGrid, insert } from "./grid";
import { createHasher, finish, mixInt } from "./hash";
import { createSim, spawnStructure, spawnUnit, type PlayerSetup } from "./state";
import type { Command, GameOptions, SimState } from "./types";
import type { MapData } from "./map";
import type { Rules } from "../data/schemas";
import { tileToWorldCenter } from "./coords";
import { runAi, aiObserve } from "./systems/ai";
import { runCommands } from "./systems/command";
import { runProduction } from "./systems/production";
import { runEconomy } from "./systems/economy";
import { runHarvest } from "./systems/harvest";
import { runMovement } from "./systems/movement";
import { runCombat, runSuicide } from "./systems/combat";
import { runFog } from "./systems/fog";
import { runVictory } from "./systems/victory";
import { runSpecial, seedNeutrals } from "./systems/special";
import { createMissionRuntime, runMission, seedMission, type MissionDef } from "./mission";

/** Missions register their definitions here so a loaded save can find its script. */
export const MISSION_REGISTRY = new Map<string, MissionDef>();

export function registerMission(def: MissionDef): void {
  MISSION_REGISTRY.set(def.id, def);
}

/** Build a campaign mission: scripted actors, optional starting units, runtime attached. */
export function createMission(rules: Rules, map: MapData, def: MissionDef): SimState {
  registerMission(def);
  const options: GameOptions = { ...DEFAULT_OPTIONS, techLevel: def.techLevel ?? 10, ...(def.options ?? {}) };
  const setups: PlayerSetup[] = def.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, isAI: p.isAI, difficulty: p.difficulty, team: p.team }));
  const state = createSim(rules, map, setups, options, def.index * 7919 + def.act * 131);
  def.players.forEach((p, i) => {
    const pl = state.players[i];
    if (pl && p.credits !== undefined) pl.credits = p.credits;
  });
  if (!def.noStartingUnits) {
    const start = map.starts[0];
    const faction = rules.factions[def.faction];
    if (start && faction) {
      faction.startingUnits.forEach((type, k) => {
        const ang = (k / faction.startingUnits.length) * Math.PI * 2;
        const r = k === 0 ? 0 : 2;
        const u = spawnUnit(state, type, 0, tileToWorldCenter(start.x + Math.round(Math.cos(ang) * r)), tileToWorldCenter(start.y + Math.round(Math.sin(ang) * r)), 16);
        u.order = { kind: "guard" };
      });
    }
  }
  seedMission(state, def);
  state.mission = createMissionRuntime(def, 0);
  refreshActorList(state);
  runFog(state);
  return state;
}

export { createSim, type PlayerSetup } from "./state";
export type { SimState, Command, Actor, Player, SimEvent, GameOptions } from "./types";

export const DEFAULT_OPTIONS: GameOptions = {
  startingCredits: 10000,
  techLevel: 10,
  shroud: true,
  crates: false,
  shortGame: true,
  unitCount: 0,
  oreGrowth: true,
};

/** Build a skirmish: players get their faction's starting units at the map's start cells. */
export function createSkirmish(rules: Rules, map: MapData, setups: PlayerSetup[], options: GameOptions, seed: number): SimState {
  const state = createSim(rules, map, setups, options, seed);
  setups.forEach((s, i) => {
    const start = map.starts[i % map.starts.length];
    if (!start) return;
    const faction = rules.factions[s.faction];
    const units = faction ? faction.startingUnits : ["mcv"];
    units.forEach((type, k) => {
      const ang = (k / units.length) * Math.PI * 2;
      const r = k === 0 ? 0 : 2;
      const x = tileToWorldCenter(start.x + Math.round(Math.cos(ang) * r));
      const y = tileToWorldCenter(start.y + Math.round(Math.sin(ang) * r));
      const u = spawnUnit(state, type, i, x, y, 16);
      u.order = { kind: "guard" };
      u.guardX = x;
      u.guardY = y;
    });
    for (let k = 0; k < options.unitCount; k++) {
      const type = s.faction === "pact" ? (k % 2 ? "heavytank" : "rifle") : k % 2 ? "mediumtank" : "rifle";
      const u = spawnUnit(state, type, i, tileToWorldCenter(start.x - 3 + (k % 6)), tileToWorldCenter(start.y + 4 + Math.floor(k / 6)), 0);
      u.order = { kind: "guard" };
    }
  });
  seedNeutrals(state, (type, tx, ty) => {
    spawnStructure(state, type, -1, tx, ty, 1);
  });
  refreshActorList(state);
  runFog(state);
  return state;
}

export function refreshActorList(state: SimState): void {
  const list = state.actorList;
  list.length = 0;
  for (const a of state.actors.values()) if (!a.dead) list.push(a);
  list.sort((a, b) => a.id - b.id);
  clearGrid(state.grid);
  for (const a of list) if (a.kind !== "projectile" && a.inside < 0) insert(state.grid, a.id, a.x, a.y);
}

export function stepSim(state: SimState, commands: Command[]): void {
  state.events.length = 0;
  refreshActorList(state);
  const aiCommands: Command[] = [];
  runAi(state, aiCommands);
  if (state.mission) {
    const def = MISSION_REGISTRY.get(state.mission.id);
    if (def) runMission(state, def, state.mission, aiCommands);
  }
  runCommands(state, [...commands, ...aiCommands]);
  runProduction(state);
  runEconomy(state);
  runSpecial(state);
  refreshActorList(state);
  runHarvest(state);
  runMovement(state);
  refreshActorList(state);
  runSuicide(state);
  runCombat(state);
  refreshActorList(state);
  runFog(state);
  runVictory(state);
  aiObserve(state);
  state.tick++;
  state.hash = computeHash(state);
}

export function computeHash(state: SimState): number {
  const hs = createHasher();
  mixInt(hs, state.tick);
  mixInt(hs, state.rng.state);
  for (const a of state.actorList) {
    mixInt(hs, a.id);
    mixInt(hs, a.x);
    mixInt(hs, a.y);
    mixInt(hs, Math.round(a.hp));
    mixInt(hs, a.owner);
    mixInt(hs, a.facing);
  }
  for (const p of state.players) {
    mixInt(hs, Math.round(p.credits));
    mixInt(hs, p.powerSupply - p.powerDrain);
  }
  return finish(hs);
}

/** Place neutral map structures (derricks, civilian buildings) if the map calls for them. */
export function placeNeutral(state: SimState, type: string, tx: number, ty: number): void {
  spawnStructure(state, type, -1, tx, ty, 1);
}
