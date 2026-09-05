// Shared simulation types. Pure data; no behaviour.

import type { Locomotor, MapData } from "./map";
import type { Rng } from "./rng";
import type { SpatialGrid } from "./grid";
import type { FactionId, QueueKind, Rules } from "../data/schemas";

export type ActorKind = "unit" | "structure" | "projectile" | "husk";

export type Stance = "aggressive" | "defensive" | "hold";

export type Order =
  | { kind: "idle" }
  | { kind: "move"; x: number; y: number }
  | { kind: "attackMove"; x: number; y: number }
  | { kind: "attack"; target: number }
  | { kind: "guard" }
  | { kind: "harvest"; tx?: number; ty?: number }
  | { kind: "returnCargo" }
  | { kind: "deploy" }
  | { kind: "capture"; target: number }
  | { kind: "repairUnit"; target: number }
  | { kind: "enter"; target: number }
  | { kind: "sabotage"; target: number }
  | { kind: "infiltrate"; target: number }
  | { kind: "layMine" }
  | { kind: "rearm" }
  | { kind: "forceMove"; x: number; y: number };

export type CrateKind = "money" | "heal" | "reveal" | "unit" | "shroud";

export type HarvestState = "idle" | "toField" | "harvesting" | "toRefinery" | "unloading";

export interface Actor {
  id: number;
  type: string;
  kind: ActorKind;
  owner: number; // player index, -1 neutral
  x: number; // leptons (center)
  y: number;
  facing: number; // 0..31
  turretFacing: number;
  hp: number;
  maxHp: number;
  // units
  loco: Locomotor;
  speed: number; // leptons per tick
  order: Order;
  queuedOrders: Order[];
  stance: Stance;
  path: Array<[number, number]> | null; // tile path
  pathIdx: number;
  moveGoal: { x: number; y: number } | null; // leptons
  repathTimer: number;
  stuckTicks: number;
  target: number; // actor id or -1
  cooldown: number[]; // per weapon
  burstLeft: number[];
  harvester: { cargo: number; gems: number; state: HarvestState; refinery: number; fieldX: number; fieldY: number } | null;
  cargo: number[]; // passenger ids
  inside: number; // transport id or -1
  prone: boolean;
  cloaked: boolean;
  ammo: number;
  lastFiredTick: number;
  revealedUntil: number; // tick until which a cloaked unit stays exposed
  guardX: number;
  guardY: number;
  // structures
  tx: number;
  ty: number;
  w: number;
  h: number;
  buildup: number; // 0..1 construction animation
  rally: { x: number; y: number } | null;
  primary: boolean;
  repairing: boolean;
  selling: boolean;
  sellTimer: number;
  charge: number; // superweapon charge ticks
  disabled: boolean; // low power / jammed
  captureProgress: number;
  // projectiles
  proj: { weapon: string; source: number; targetId: number; tx: number; ty: number; ttl: number; arcT: number; arcTotal: number; sx: number; sy: number } | null;
  // husk
  huskTtl: number;
  // bookkeeping
  dead: boolean;
  lastDamagedTick: number;
  lastAttacker: number;
  kills: number;
  spawnedTick: number;
}

export interface QueueItem {
  type: string;
  progress: number; // 0..1
  paid: number; // credits paid so far
  count: number; // remaining copies of this type queued (first one in progress)
}

export interface ProductionQueue {
  items: QueueItem[];
  hold: boolean;
  ready: boolean; // building/defense ready to place
}

export interface Player {
  id: number;
  name: string;
  faction: FactionId;
  color: string;
  isAI: boolean;
  difficulty: "easy" | "normal" | "hard";
  team: number;
  credits: number; // cash + ore
  ore: number; // harvested portion, bounded by storage (classic split)
  storage: number;
  powerSupply: number;
  powerDrain: number;
  alive: boolean;
  defeated: boolean;
  queues: Record<QueueKind, ProductionQueue>;
  radarActive: boolean;
  gps: boolean; // permanent map reveal (explored) once GPS launches
  discovered: string[]; // captured enemy tech types
  stats: { built: number; lost: number; kills: number; harvested: number };
  superweapons: Record<string, { charge: number; ready: boolean }>;
  ai: AiMemory | null;
}

export interface AiMemory {
  phase: number;
  nextThinkTick: number;
  attackWaveAt: number;
  rallyX: number;
  rallyY: number;
  targetX: number;
  targetY: number;
  attacking: boolean;
  lastBaseAttackTick: number;
  buildOrderIdx: number;
  failedPlacements: number;
}

export type Command = { player: number } & (
  | { kind: "move"; actors: number[]; x: number; y: number; queue: boolean }
  | { kind: "attackMove"; actors: number[]; x: number; y: number; queue: boolean }
  | { kind: "attack"; actors: number[]; target: number; queue: boolean }
  | { kind: "force"; actors: number[]; x: number; y: number } // force-fire ground
  | { kind: "stop"; actors: number[] }
  | { kind: "guard"; actors: number[] }
  | { kind: "scatter"; actors: number[] }
  | { kind: "deploy"; actors: number[] }
  | { kind: "harvest"; actors: number[]; tx: number; ty: number }
  | { kind: "stance"; actors: number[]; stance: Stance }
  | { kind: "enter"; actors: number[]; target: number }
  | { kind: "unload"; actors: number[] }
  | { kind: "queue"; queue: QueueKind; type: string }
  | { kind: "dequeue"; queue: QueueKind; type: string }
  | { kind: "hold"; queue: QueueKind; hold: boolean }
  | { kind: "place"; type: string; tx: number; ty: number }
  | { kind: "cancelPlace"; queue: QueueKind }
  | { kind: "sell"; actor: number }
  | { kind: "repair"; actor: number }
  | { kind: "setRally"; actor: number; x: number; y: number }
  | { kind: "setPrimary"; actor: number }
  | { kind: "superweapon"; power: string; x: number; y: number; actors: number[] }
  | { kind: "forceMove"; actors: number[]; x: number; y: number; queue: boolean }
  | { kind: "phaseJump"; actor: number; x: number; y: number }
  | { kind: "placeWall"; type: string; cells: Array<[number, number]> }
  | { kind: "surrender" }
);

export type SimEvent =
  | { kind: "explosion"; x: number; y: number; size: number; tick: number }
  | { kind: "muzzle"; x: number; y: number; facing: number; tick: number }
  | { kind: "sfx"; name: string; x: number; y: number; player: number }
  | { kind: "eva"; cue: string; player: number }
  | { kind: "placed"; actor: number; player: number }
  | { kind: "unitReady"; actor: number; player: number }
  | { kind: "died"; actor: number; type: string; kind2: ActorKind; x: number; y: number; player: number }
  | { kind: "victory"; player: number }
  | { kind: "defeat"; player: number }
  | { kind: "baseAttack"; player: number; x: number; y: number }
  | { kind: "harvesterAttack"; player: number; x: number; y: number }
  | { kind: "text"; player: number; text: string }
  | { kind: "crate"; player: number; crate: string; x: number; y: number };

export interface GameOptions {
  startingCredits: number;
  techLevel: number;
  shroud: boolean;
  crates: boolean;
  shortGame: boolean;
  unitCount: number;
  oreGrowth: boolean;
}

export interface SimState {
  tick: number;
  seed: number;
  rng: Rng;
  map: MapData;
  actors: Map<number, Actor>;
  actorList: Actor[]; // rebuilt each tick, sorted by id for determinism
  nextId: number;
  players: Player[];
  fog: Uint8Array[]; // per player: 0 shroud, 1 explored, 2 visible
  grid: SpatialGrid;
  events: SimEvent[];
  phaseReturns: Array<{ id: number; x: number; y: number; tick: number }>;
  mission: import("./mission").MissionRuntime | null;
  crates: Array<{ tx: number; ty: number; kind: CrateKind }>;
  winner: number; // -1 none, team id when decided
  finished: boolean;
  options: GameOptions;
  rules: Rules;
  hash: number;
}
