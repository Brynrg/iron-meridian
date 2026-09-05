// Zod schemas for the rules data in data/*.json. Every number the simulation
// uses comes through here; systems never hard-code balance values.

import { z } from "zod";

export const ArmorSchema = z.enum(["none", "wood", "light", "heavy", "concrete"]);
export type Armor = z.infer<typeof ArmorSchema>;

export const LocomotorSchema = z.enum(["foot", "wheel", "track", "naval", "air", "none"]);
export const QueueKindSchema = z.enum(["building", "defense", "infantry", "vehicle", "aircraft", "ship"]);
export type QueueKind = z.infer<typeof QueueKindSchema>;
export const FactionIdSchema = z.enum(["alliance", "pact"]);
export type FactionId = z.infer<typeof FactionIdSchema>;
export const TargetClassSchema = z.enum(["ground", "air", "naval"]);
export const ProjectileKindSchema = z.enum(["instant", "bullet", "shell", "missile", "flame", "arc", "torpedo", "heal"]);
export type ProjectileKind = z.infer<typeof ProjectileKindSchema>;

export const WarheadSchema = z.object({
  versus: z.record(ArmorSchema, z.number()), // percent
  spread: z.number().default(0), // cells of splash radius
  infantryOnly: z.boolean().default(false),
  ignoresBuildings: z.boolean().default(false),
});
export type WarheadDef = z.infer<typeof WarheadSchema>;

export const WeaponSchema = z.object({
  damage: z.number(),
  rof: z.number(), // ticks between shots
  range: z.number(), // cells
  minRange: z.number().default(0),
  projectile: ProjectileKindSchema,
  speed: z.number().default(0), // leptons per tick (0 = instant)
  warhead: z.string(),
  burst: z.number().default(1),
  burstDelay: z.number().default(3),
  targets: z.array(TargetClassSchema).default(["ground"]),
  inaccuracy: z.number().default(0), // cells of scatter
  sound: z.string().default("gun"),
});
export type WeaponDef = z.infer<typeof WeaponSchema>;

export const UnitSchema = z.object({
  name: z.string(),
  class: z.enum(["infantry", "vehicle", "aircraft", "ship"]),
  queue: QueueKindSchema,
  cost: z.number(),
  buildTime: z.number(), // seconds at full power
  hp: z.number(),
  armor: ArmorSchema,
  speed: z.number(), // cells per second
  turnRate: z.number().default(8), // facings per tick
  loco: LocomotorSchema,
  sight: z.number(), // cells
  weapons: z.array(z.string()).default([]),
  turret: z.boolean().default(false),
  prereq: z.array(z.string()).default([]),
  factions: z.array(FactionIdSchema).default(["alliance", "pact"]),
  tech: z.number().default(1),
  harvester: z.object({ capacity: z.number() }).optional(),
  deploysTo: z.string().optional(),
  cargo: z.number().default(0),
  crushes: z.boolean().default(false),
  crushable: z.boolean().default(false),
  cloaked: z.boolean().default(false),
  detector: z.boolean().default(false),
  engineer: z.boolean().default(false),
  medic: z.boolean().default(false),
  mechanic: z.boolean().default(false),
  spy: z.boolean().default(false),
  thief: z.boolean().default(false),
  c4: z.boolean().default(false),
  minelayer: z.boolean().default(false),
  jammer: z.number().default(0), // cells of radar jamming
  gap: z.number().default(0), // cells of shroud generation
  suicide: z.boolean().default(false),
  hero: z.boolean().default(false),
  buildLimit: z.number().default(0),
  ammo: z.number().default(0), // aircraft/minelayer shots before rearming (0 = unlimited)
  phaseJump: z.number().default(0), // cells of self-teleport range (0 = none)
  desc: z.string().default(""),
});
export type UnitDef = z.infer<typeof UnitSchema>;

export const StructureSchema = z.object({
  name: z.string(),
  queue: QueueKindSchema,
  cost: z.number(),
  buildTime: z.number(),
  hp: z.number(),
  armor: ArmorSchema,
  power: z.number().default(0), // + supply, - drain
  footprint: z.tuple([z.number(), z.number()]),
  sight: z.number().default(4),
  weapons: z.array(z.string()).default([]),
  turret: z.boolean().default(false),
  prereq: z.array(z.string()).default([]),
  factions: z.array(FactionIdSchema).default(["alliance", "pact"]),
  tech: z.number().default(1),
  produces: z.array(QueueKindSchema).default([]),
  exit: z.tuple([z.number(), z.number()]).optional(), // cell offset units emerge from
  storage: z.number().default(0),
  refinery: z.boolean().default(false),
  radar: z.boolean().default(false),
  wall: z.boolean().default(false),
  gate: z.boolean().default(false),
  mine: z.boolean().default(false),
  gap: z.number().default(0),
  detector: z.boolean().default(false),
  needsPower: z.boolean().default(false), // weapons/abilities disabled at low power
  superweapon: z.enum(["phase", "aegis", "nuke", "recon", "paradrop", "sonar", "gps"]).optional(),
  superweaponFactions: z.array(FactionIdSchema).optional(), // restrict a shared building's power
  chargeTime: z.number().default(0), // seconds
  repairs: z.boolean().default(false), // service depot
  helipad: z.boolean().default(false),
  capturable: z.boolean().default(true),
  sellable: z.boolean().default(true),
  fake: z.string().optional(), // looks like this type
  buildLimit: z.number().default(0),
  baseNormal: z.boolean().default(true), // extends build radius
  desc: z.string().default(""),
});
export type StructureDef = z.infer<typeof StructureSchema>;

export const FactionSchema = z.object({
  name: z.string(),
  short: z.string(),
  blurb: z.string(),
  startingUnits: z.array(z.string()),
});
export type FactionDef = z.infer<typeof FactionSchema>;

export const RulesSchema = z.object({
  weapons: z.record(z.string(), WeaponSchema),
  warheads: z.record(z.string(), WarheadSchema),
  units: z.record(z.string(), UnitSchema),
  structures: z.record(z.string(), StructureSchema),
  factions: z.record(FactionIdSchema, FactionSchema),
  general: z.object({
    startingCredits: z.number(),
    oreValue: z.number(),
    gemValue: z.number(),
    harvestTicksPerBale: z.number(),
    unloadTicksPerBale: z.number(),
    oreGrowthSeconds: z.number(),
    baseRadius: z.number(), // cells from an existing structure a new one may be placed
    sellRefund: z.number(), // fraction
    repairCostFraction: z.number(), // fraction of cost to fully repair
    repairHpPerSecond: z.number(),
    lowPowerBuildMultiplier: z.number(),
    conYardBuildSpeedBonus: z.number(),
    crushDamage: z.number(),
    captureThreshold: z.number(), // engineer captures when hp fraction below this (1 = always)
    shortGame: z.boolean(),
  }),
});
export type Rules = z.infer<typeof RulesSchema>;
