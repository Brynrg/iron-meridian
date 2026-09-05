// Tile map: terrain classes, resources, and the occupancy layer that
// structures write into. Pure data + pure helpers; no rendering.

import { LEPTONS_PER_CELL } from "./coords";

export const enum Terrain {
  Clear = 0,
  Road = 1,
  Rough = 2,
  Beach = 3,
  Water = 4,
  Cliff = 5,
  Tree = 6,
  Bridge = 7,
  Rock = 8,
}

export type Locomotor = "foot" | "wheel" | "track" | "naval" | "air" | "none";

export interface MapData {
  name: string;
  width: number;
  height: number;
  terrain: Uint8Array; // Terrain per cell
  ore: Uint16Array; // resource units per cell (0 = none)
  gems: Uint8Array; // 1 if the cell holds gems instead of ore
  oreMine: Uint8Array; // 1 if the cell regrows ore
  occupancy: Int32Array; // actor id occupying the cell (structures, trees), -1 = free
  gateTeam: Int8Array; // team that may pass through the occupying gate, -1 = not a gate
  starts: Array<{ x: number; y: number }>; // start cells
}

export const ORE_PER_CELL_MAX = 12; // "bales" per cell
export const ORE_VALUE = 25; // credits per bale
export const GEM_VALUE = 50;

export function createMap(name: string, width: number, height: number): MapData {
  return {
    name,
    width,
    height,
    terrain: new Uint8Array(width * height),
    ore: new Uint16Array(width * height),
    gems: new Uint8Array(width * height),
    oreMine: new Uint8Array(width * height),
    occupancy: new Int32Array(width * height).fill(-1),
    gateTeam: new Int8Array(width * height).fill(-1),
    starts: [],
  };
}

export function inBounds(m: MapData, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < m.width && ty < m.height;
}

export function idx(m: MapData, tx: number, ty: number): number {
  return ty * m.width + tx;
}

export function terrainAt(m: MapData, tx: number, ty: number): Terrain {
  if (!inBounds(m, tx, ty)) return Terrain.Cliff;
  return m.terrain[idx(m, tx, ty)] as Terrain;
}

/** Movement cost multiplier (x100) for a locomotor on a terrain, or 0 = impassable. */
export function terrainCost(t: Terrain, loco: Locomotor): number {
  switch (loco) {
    case "air":
      return 100;
    case "naval":
      return t === Terrain.Water ? 100 : 0;
    case "foot":
      switch (t) {
        case Terrain.Clear:
          return 100;
        case Terrain.Road:
          return 90;
        case Terrain.Rough:
          return 120;
        case Terrain.Beach:
          return 110;
        case Terrain.Bridge:
          return 100;
        default:
          return 0;
      }
    case "wheel":
      switch (t) {
        case Terrain.Clear:
          return 100;
        case Terrain.Road:
          return 70;
        case Terrain.Rough:
          return 170;
        case Terrain.Beach:
          return 130;
        case Terrain.Bridge:
          return 100;
        default:
          return 0;
      }
    case "track":
      switch (t) {
        case Terrain.Clear:
          return 100;
        case Terrain.Road:
          return 85;
        case Terrain.Rough:
          return 125;
        case Terrain.Beach:
          return 115;
        case Terrain.Bridge:
          return 100;
        default:
          return 0;
      }
    case "none":
      return 0;
  }
}

export function isPassable(m: MapData, tx: number, ty: number, loco: Locomotor, ignoreOccupant = -1, team = -1): boolean {
  if (!inBounds(m, tx, ty)) return false;
  const i = idx(m, tx, ty);
  if (terrainCost(m.terrain[i] as Terrain, loco) === 0) return false;
  if (loco === "air") return true;
  const occ = m.occupancy[i] as number;
  if (occ === -1 || occ === ignoreOccupant) return true;
  return team >= 0 && (m.gateTeam[i] as number) === team;
}

export function setGate(m: MapData, tx: number, ty: number, team: number): void {
  if (inBounds(m, tx, ty)) m.gateTeam[idx(m, tx, ty)] = team;
}

export function isBuildable(m: MapData, tx: number, ty: number): boolean {
  if (!inBounds(m, tx, ty)) return false;
  const i = idx(m, tx, ty);
  const t = m.terrain[i] as Terrain;
  if (t !== Terrain.Clear && t !== Terrain.Road && t !== Terrain.Rough && t !== Terrain.Beach) return false;
  if ((m.ore[i] as number) > 0) return false;
  return (m.occupancy[i] as number) === -1;
}

export function setOccupancy(m: MapData, tx: number, ty: number, w: number, h: number, id: number): void {
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (inBounds(m, x, y)) m.occupancy[idx(m, x, y)] = id;
    }
  }
}

export function clearOccupancy(m: MapData, id: number): void {
  const occ = m.occupancy;
  for (let i = 0; i < occ.length; i++)
    if (occ[i] === id) {
      occ[i] = -1;
      m.gateTeam[i] = -1;
    }
}

export function mapWidthLeptons(m: MapData): number {
  return m.width * LEPTONS_PER_CELL;
}

export function mapHeightLeptons(m: MapData): number {
  return m.height * LEPTONS_PER_CELL;
}

/** Serialise map to a compact JSON-safe object (for saves). */
export function serializeMap(m: MapData): Record<string, unknown> {
  return {
    name: m.name,
    width: m.width,
    height: m.height,
    terrain: Array.from(m.terrain),
    ore: Array.from(m.ore),
    gems: Array.from(m.gems),
    oreMine: Array.from(m.oreMine),
    occupancy: Array.from(m.occupancy),
    gateTeam: Array.from(m.gateTeam),
    starts: m.starts,
  };
}

export function deserializeMap(o: Record<string, unknown>): MapData {
  const width = o.width as number;
  const height = o.height as number;
  const m = createMap(o.name as string, width, height);
  m.terrain.set(o.terrain as number[]);
  m.ore.set(o.ore as number[]);
  m.gems.set(o.gems as number[]);
  m.oreMine.set(o.oreMine as number[]);
  m.occupancy.set(o.occupancy as number[]);
  if (o.gateTeam) m.gateTeam.set(o.gateTeam as number[]);
  m.starts = o.starts as Array<{ x: number; y: number }>;
  return m;
}
