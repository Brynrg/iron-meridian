// The two campaigns: 14 Meridian Alliance missions and 14 Ural Pact missions.
// Each spec produces a MissionDef once the map exists, so scripted positions
// are expressed relative to the map's start cells.

import type { FactionId } from "./schemas";
import type { MapData } from "../sim/map";
import type { MissionDef, Objective, Trigger } from "../sim/mission";
import type { PlayerSetup } from "../sim/state";

type Start = { x: number; y: number };
type ActorSpec = MissionDef["actors"][number];

export interface MissionSpec {
  id: string;
  faction: FactionId;
  act: number;
  index: number;
  title: string;
  briefing: string[];
  map: { seed: number; width: number; height: number; waterAmount: number; oreAmount: number; players: number };
  make: (starts: Start[]) => Omit<MissionDef, "id" | "faction" | "act" | "index" | "title" | "briefing" | "map">;
}

const BLUE = "#3a7bd5";
const RED = "#d53a3a";

function human(faction: FactionId, credits: number): PlayerSetup & { credits?: number } {
  return { name: "Commander", faction, color: faction === "alliance" ? BLUE : RED, isAI: false, team: 0, credits };
}

function enemy(faction: FactionId, ai: boolean, difficulty: "easy" | "normal" | "hard", credits: number, team = 1, color?: string): PlayerSetup & { credits?: number } {
  return { name: faction === "alliance" ? "Alliance Command" : "Pact Command", faction, color: color ?? (faction === "alliance" ? BLUE : RED), isAI: ai, difficulty, team, credits };
}

/** A pre-built enemy base around a start cell. tier 1 = outpost, 2 = base, 3 = fortress. */
function base(owner: number, s: Start, tier: 1 | 2 | 3, faction: FactionId): ActorSpec[] {
  const a: ActorSpec[] = [];
  const x = s.x;
  const y = s.y;
  const pact = faction === "pact";
  a.push({ type: "conyard", owner, tx: x - 1, ty: y - 1 });
  a.push({ type: "power", owner, tx: x + 3, ty: y - 3 });
  a.push({ type: "barracks", owner, tx: x - 5, ty: y - 4 });
  a.push({ type: "refinery", owner, tx: x - 6, ty: y + 1 });
  a.push({ type: "oretruck", owner, tx: x - 4, ty: y + 5, order: "harvest" });
  a.push({ type: "rifle", owner, tx: x - 2, ty: y + 3, count: 3 });
  if (pact) a.push({ type: "flametower", owner, tx: x - 8, ty: y - 6 });
  else a.push({ type: "pillbox", owner, tx: x - 8, ty: y - 6 });
  if (tier >= 2) {
    a.push({ type: "power", owner, tx: x + 3, ty: y });
    a.push({ type: "factory", owner, tx: x + 1, ty: y + 3 });
    a.push({ type: "radar", owner, tx: x + 6, ty: y - 3 });
    a.push({ type: pact ? "heavytank" : "mediumtank", owner, tx: x + 5, ty: y + 4, count: 2 });
    a.push({ type: pact ? "flametower" : "turret", owner, tx: x + 8, ty: y + 6 });
    a.push({ type: pact ? "samsite" : "aagun", owner, tx: x - 8, ty: y + 6 });
    a.push({ type: "rocket", owner, tx: x + 2, ty: y - 5, count: 2 });
  }
  if (tier >= 3) {
    a.push({ type: "apower", owner, tx: x + 6, ty: y + 1 });
    a.push({ type: "techcenter", owner, tx: x + 5, ty: y - 7 });
    a.push({ type: pact ? "arctower" : "turret", owner, tx: x, ty: y - 8 });
    a.push({ type: pact ? "arctower" : "camopillbox", owner, tx: x + 8, ty: y - 6 });
    a.push({ type: pact ? "kolossus" : "mediumtank", owner, tx: x - 6, ty: y - 8, count: 2 });
    a.push({ type: pact ? "arctank" : "artillery", owner, tx: x + 7, ty: y + 8, count: 2 });
    a.push({ type: "sandbag", owner, tx: x - 9, ty: y - 9, count: 6 });
  }
  return a;
}

function wave(id: string, seconds: number, owner: number, from: Start, to: Start, units: Array<{ type: string; count: number }>): Trigger {
  return { id, when: { kind: "time", seconds }, actions: [{ kind: "reinforce", owner, units, tx: from.x + 2, ty: from.y + 8, order: "attackMove", toTx: to.x, toTy: to.y }] };
}

function repeatWaves(prefix: string, start: number, every: number, count: number, owner: number, from: Start, to: Start, units: Array<{ type: string; count: number }>): Trigger[] {
  const out: Trigger[] = [];
  for (let i = 0; i < count; i++) out.push(wave(`${prefix}${i}`, start + i * every, owner, from, to, units.map((u) => ({ type: u.type, count: u.count + Math.floor(i / 2) }))));
  return out;
}

const destroyAll = (owner: number, text = "Destroy all enemy forces and structures."): Objective => ({ id: `destroy${owner}`, kind: "destroyAll", owner, text });
const protectYard = (): Objective => ({ id: "protectYard", kind: "protect", type: "conyard", text: "Keep your Construction Yard standing.", optional: false });
const startMsg = (text: string): Trigger => ({ id: "startMsg", when: { kind: "start" }, actions: [{ kind: "message", text }, { kind: "reveal", owner: 0, tx: 0, ty: 0, r: 0 }] });

// ── Meridian Alliance campaign ───────────────────────────────────────────────

const ALLIANCE: MissionSpec[] = [
  {
    id: "a01",
    faction: "alliance",
    act: 1,
    index: 1,
    title: "Landfall",
    briefing: [
      "Pact raiders have taken a listening post on the northern coast. No construction support is available.",
      "You have a rifle platoon, a medic, and two Rangers. Destroy the outpost. Reinforcements will follow once you are engaged.",
    ],
    map: { seed: 9001, width: 40, height: 40, waterAmount: 0.3, oreAmount: 0.3, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 0), enemy("pact", false, "easy", 0)],
      noStartingUnits: true,
      techLevel: 1,
      actors: [
        { type: "rifle", owner: 0, tx: p!.x - 2, ty: p!.y, count: 6 },
        { type: "medic", owner: 0, tx: p!.x, ty: p!.y + 2 },
        { type: "ranger", owner: 0, tx: p!.x + 2, ty: p!.y + 2, count: 2 },
        { type: "power", owner: 1, tx: e!.x + 2, ty: e!.y - 2 },
        { type: "barracks", owner: 1, tx: e!.x - 3, ty: e!.y - 2 },
        { type: "radar", owner: 1, tx: e!.x, ty: e!.y + 2 },
        { type: "flametower", owner: 1, tx: e!.x - 4, ty: e!.y + 3 },
        { type: "rifle", owner: 1, tx: e!.x - 2, ty: e!.y + 4, count: 4 },
        { type: "grenadier", owner: 1, tx: e!.x + 3, ty: e!.y + 3, count: 2 },
      ],
      objectives: [{ id: "post", kind: "destroyStructures", owner: 1, text: "Destroy the Pact listening post." }],
      triggers: [
        startMsg("Command: move north-east and hit the post before they call for help."),
        { id: "reinf", when: { kind: "unitEnters", area: { tx: e!.x, ty: e!.y, r: 10 }, owner: 0 }, actions: [{ kind: "reinforce", owner: 0, units: [{ type: "rifle", count: 4 }, { type: "rocket", count: 2 }], tx: p!.x, ty: p!.y, order: "attackMove", toTx: e!.x, toTy: e!.y }, { kind: "message", text: "Reinforcements landing at the beach." }] },
      ],
    }),
  },
  {
    id: "a02",
    faction: "alliance",
    act: 1,
    index: 2,
    title: "Beachhead",
    briefing: ["Establish a forward base with the MCV, then destroy the Pact outpost across the plain.", "Build a Barracks and a Refinery first; the Pact will probe your position."],
    map: { seed: 9002, width: 48, height: 48, waterAmount: 0.2, oreAmount: 0.6, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 5000), enemy("pact", true, "easy", 3000)],
      techLevel: 2,
      actors: base(1, e!, 1, "pact"),
      objectives: [
        { id: "barracks", kind: "buildType", type: "barracks", text: "Build a Barracks." },
        { id: "ref", kind: "buildType", type: "refinery", text: "Build an Ore Refinery." },
        destroyAll(1),
      ],
      triggers: [startMsg("Command: deploy the MCV on open ground and get the economy running."), ...repeatWaves("w", 240, 180, 3, 1, e!, p!, [{ type: "rifle", count: 3 }, { type: "grenadier", count: 1 }])],
    }),
  },
  {
    id: "a03",
    faction: "alliance",
    act: 1,
    index: 3,
    title: "Eyes on the Front",
    briefing: ["A Pact Radar Dome is coordinating raids across the sector. Capture it intact with Engineers.", "You have twelve minutes before Pact armour arrives to reclaim it. Hold the dome until then."],
    map: { seed: 9003, width: 48, height: 48, waterAmount: 0.1, oreAmount: 0.5, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 4000), enemy("pact", false, "normal", 0)],
      techLevel: 2,
      actors: [
        { type: "engineer", owner: 0, tx: p!.x + 2, ty: p!.y + 3, count: 3 },
        { type: "radar", owner: 1, tx: e!.x, ty: e!.y },
        { type: "power", owner: 1, tx: e!.x + 3, ty: e!.y },
        { type: "flametower", owner: 1, tx: e!.x - 3, ty: e!.y - 2 },
        { type: "rifle", owner: 1, tx: e!.x - 2, ty: e!.y + 3, count: 5 },
        { type: "rifle", owner: 1, tx: e!.x + 4, ty: e!.y + 3, count: 2 },
      ],
      objectives: [
        { id: "cap", kind: "captureType", type: "radar", text: "Capture the Pact Radar Dome." },
        { id: "hold", kind: "protect", type: "radar", owner: 0, hidden: true, text: "Hold the Radar Dome until relieved." },
        { id: "relief", kind: "survive", seconds: 420, hidden: true, text: "Survive until the relief column arrives (five minutes after the capture)." },
      ],
      triggers: [
        startMsg("Command: Engineers capture on contact. Keep them alive."),
        { id: "held", when: { kind: "objectiveDone", id: "cap" }, actions: [{ kind: "activate", id: "hold" }, { kind: "activate", id: "relief" }, { kind: "message", text: "Pact armour inbound. Hold for five minutes." }] },
        { id: "counter1", when: { kind: "objectiveDone", id: "cap" }, actions: [{ kind: "reinforce", owner: 1, units: [{ type: "heavytank", count: 2 }, { type: "rifle", count: 4 }], tx: e!.x + 8, ty: e!.y + 8, order: "attackMove", toTx: e!.x, toTy: e!.y }] },
        { id: "relief", when: { kind: "time", seconds: 99999 }, actions: [] },
        { id: "win", when: { kind: "objectiveDone", id: "cap" }, actions: [{ kind: "message", text: "Relief will arrive when the timer expires." }] },
      ],
    }),
  },
  {
    id: "a04",
    faction: "alliance",
    act: 1,
    index: 4,
    title: "Ore Rush",
    briefing: ["The treasury is empty. Bank 12,000 credits from the gem fields while Pact raiders harass your trucks.", "Silos will be needed. Guard the harvesters."],
    map: { seed: 9004, width: 56, height: 56, waterAmount: 0.1, oreAmount: 1.0, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 3000), enemy("pact", false, "normal", 0)],
      techLevel: 3,
      actors: [{ type: "flametower", owner: 1, tx: e!.x, ty: e!.y }, { type: "power", owner: 1, tx: e!.x + 2, ty: e!.y + 2 }],
      objectives: [{ id: "cash", kind: "harvest", amount: 12000, text: "Harvest 12,000 credits of ore and gems." }, protectYard()],
      triggers: [startMsg("Command: harvest fast, build silos, and keep a picket on the truck routes."), ...repeatWaves("raid", 150, 120, 8, 1, e!, p!, [{ type: "ranger", count: 0 }, { type: "grenadier", count: 2 }, { type: "rifle", count: 2 }])],
    }),
  },
  {
    id: "a05",
    faction: "alliance",
    act: 2,
    index: 5,
    title: "Cold Harbour",
    briefing: ["Pact submarines are strangling the northern convoys. Build a Naval Yard and sink the Submarine Pen.", "Gunboats detect submarines; Destroyers kill them. Cruisers can shell the pen from range."],
    map: { seed: 9005, width: 64, height: 64, waterAmount: 0.5, oreAmount: 0.7, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 8000), enemy("pact", true, "normal", 6000)],
      techLevel: 4,
      actors: [...base(1, e!, 2, "pact"), { type: "subpen", owner: 1, tx: e!.x + 6, ty: e!.y + 6 }, { type: "sub", owner: 1, tx: e!.x, ty: e!.y + 12, count: 2 }],
      objectives: [{ id: "yard", kind: "buildType", type: "navalyard", text: "Build a Naval Yard on the shore." }, { id: "pen", kind: "destroyType", owner: 1, type: "subpen", text: "Destroy the Submarine Pen." }],
      triggers: [startMsg("Command: the Pact pen is on the far shore. Expect torpedo attacks on your yard.")],
    }),
  },
  {
    id: "a06",
    faction: "alliance",
    act: 2,
    index: 6,
    title: "Iron Rain",
    briefing: ["A Pact armoured column is rolling toward the pass. Fortify and hold for ten minutes until air support is released.", "Turrets and Pillboxes on the approach. Rocket soldiers behind sandbags."],
    map: { seed: 9006, width: 56, height: 56, waterAmount: 0.05, oreAmount: 0.6, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 9000), enemy("pact", false, "normal", 0)],
      techLevel: 4,
      actors: [{ type: "conyard", owner: 0, tx: p!.x - 1, ty: p!.y - 1 }, { type: "power", owner: 0, tx: p!.x + 3, ty: p!.y - 3 }, { type: "barracks", owner: 0, tx: p!.x - 5, ty: p!.y - 3 }, { type: "factory", owner: 0, tx: p!.x + 1, ty: p!.y + 3 }, { type: "refinery", owner: 0, tx: p!.x - 6, ty: p!.y + 1 }, { type: "oretruck", owner: 0, tx: p!.x - 4, ty: p!.y + 5, order: "harvest" }],
      noStartingUnits: true,
      objectives: [{ id: "hold", kind: "survive", seconds: 600, text: "Hold the pass for ten minutes." }, protectYard()],
      triggers: [
        startMsg("Command: the column arrives in two minutes. Dig in."),
        ...repeatWaves("col", 120, 75, 7, 1, e!, p!, [{ type: "heavytank", count: 2 }, { type: "rifle", count: 3 }, { type: "rocketlauncher", count: 0 }]),
        { id: "air", when: { kind: "time", seconds: 600 }, actions: [{ kind: "message", text: "Air support released. The column is breaking off." }] },
      ],
    }),
  },
  {
    id: "a07",
    faction: "alliance",
    act: 2,
    index: 7,
    title: "Silent Service",
    briefing: ["A Pact atomic programme is hidden behind a Gap Generator field. Infiltrate the Radar Dome with a Spy to reveal it, then level the Missile Silo.", "The Spy is disguised; dogs will see through it."],
    map: { seed: 9007, width: 64, height: 64, waterAmount: 0.2, oreAmount: 0.6, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 10000), enemy("pact", true, "easy", 5000)],
      techLevel: 6,
      actors: [...base(1, e!, 2, "pact"), { type: "missilesilo", owner: 1, tx: e!.x + 7, ty: e!.y - 6 }, { type: "kennel", owner: 1, tx: e!.x - 7, ty: e!.y - 1 }, { type: "dog", owner: 1, tx: e!.x - 6, ty: e!.y + 1, count: 2 }],
      objectives: [{ id: "spy", kind: "reach", area: { tx: e!.x + 6, ty: e!.y - 3, r: 3 }, type: "spy", text: "Get a Spy into the Pact Radar Dome." }, { id: "silo", kind: "destroyType", owner: 1, type: "missilesilo", text: "Destroy the Missile Silo." }],
      triggers: [startMsg("Command: intelligence first, then the strike. Spies enter buildings on right-click.")],
    }),
  },
  {
    id: "a08",
    faction: "alliance",
    act: 2,
    index: 8,
    title: "Chokepoint",
    briefing: ["Two Arc Towers guard the only road through the mountains. Artillery outranges them; bring it forward under escort.", "Then clear the garrison."],
    map: { seed: 9008, width: 56, height: 56, waterAmount: 0.05, oreAmount: 0.5, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 12000), enemy("pact", true, "easy", 4000)],
      techLevel: 5,
      actors: [...base(1, e!, 2, "pact"), { type: "arctower", owner: 1, tx: e!.x - 9, ty: e!.y - 6 }, { type: "arctower", owner: 1, tx: e!.x - 4, ty: e!.y - 9 }],
      objectives: [{ id: "towers", kind: "destroyType", owner: 1, type: "arctower", count: 2, text: "Destroy the two Arc Towers guarding the pass." }, destroyAll(1)],
      triggers: [startMsg("Command: Arc Towers need power. Killing the plants shuts them down too.")],
    }),
  },
  {
    id: "a09",
    faction: "alliance",
    act: 3,
    index: 9,
    title: "Airlift",
    briefing: ["Pact fighters own the sky over the steppe. Build a Helipad, field two Attack Helicopters, and destroy the Airfield.", "AA Guns will keep their fighters off your base."],
    map: { seed: 9009, width: 64, height: 64, waterAmount: 0.15, oreAmount: 0.7, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 10000), enemy("pact", true, "easy", 5000)],
      techLevel: 6,
      actors: [...base(1, e!, 2, "pact"), { type: "airfield", owner: 1, tx: e!.x + 6, ty: e!.y + 6 }, { type: "yak", owner: 1, tx: e!.x + 7, ty: e!.y + 6, count: 2 }],
      objectives: [{ id: "heli", kind: "buildType", type: "longbow", count: 2, text: "Field two Attack Helicopters." }, { id: "field", kind: "destroyType", owner: 1, type: "airfield", text: "Destroy the Pact Airfield." }, destroyAll(1)],
      triggers: [startMsg("Command: helicopters rearm at the Helipad. Watch their ammunition.")],
    }),
  },
  {
    id: "a10",
    faction: "alliance",
    act: 3,
    index: 10,
    title: "The Long Winter",
    briefing: ["The Pact has consolidated a full base on the far side of the tundra. This will be a long fight.", "Expand to the gem fields, tech to the Technology Centre, and grind them down."],
    map: { seed: 9010, width: 80, height: 80, waterAmount: 0.25, oreAmount: 0.8, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 10000), enemy("pact", true, "normal", 8000)],
      techLevel: 7,
      actors: base(1, e!, 3, "pact"),
      objectives: [destroyAll(1)],
      triggers: [startMsg("Command: no tricks this time. Out-produce them.")],
    }),
  },
  {
    id: "a11",
    faction: "alliance",
    act: 3,
    index: 11,
    title: "Behind the Curtain",
    briefing: ["The Aegis Field Generator makes Pact armour invulnerable. A Commando team is inside the perimeter. Plant charges on the generator.", "No base, no reinforcements. Avoid the dogs."],
    map: { seed: 9011, width: 48, height: 48, waterAmount: 0.1, oreAmount: 0.3, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 0), enemy("pact", false, "normal", 0)],
      noStartingUnits: true,
      techLevel: 8,
      actors: [
        { type: "commando", owner: 0, tx: p!.x, ty: p!.y },
        { type: "rifle", owner: 0, tx: p!.x - 1, ty: p!.y + 2, count: 3 },
        { type: "medic", owner: 0, tx: p!.x + 1, ty: p!.y + 2 },
        ...base(1, e!, 1, "pact"),
        { type: "aegis", owner: 1, tx: e!.x + 6, ty: e!.y + 6 },
        { type: "dog", owner: 1, tx: e!.x - 3, ty: e!.y - 6, count: 2 },
      ],
      objectives: [{ id: "aegis", kind: "destroyType", owner: 1, type: "aegis", text: "Destroy the Aegis Field Generator." }, { id: "cmd", kind: "protect", type: "commando", text: "The Commando must survive." }],
      triggers: [startMsg("Command: the Commando plants C4 on right-click. Buildings only.")],
    }),
  },
  {
    id: "a12",
    faction: "alliance",
    act: 4,
    index: 12,
    title: "Shockwave",
    briefing: ["The Pact Missile Silo is armed. Capture it before the twenty-five-minute launch window closes, or your base will be gone.", "Engineers with an armoured escort. Go now."],
    map: { seed: 9012, width: 64, height: 64, waterAmount: 0.1, oreAmount: 0.6, players: 2 },
    make: ([p, e]) => ({
      players: [human("alliance", 12000), enemy("pact", true, "easy", 6000)],
      techLevel: 8,
      actors: [...base(1, e!, 2, "pact"), { type: "missilesilo", owner: 1, tx: e!.x + 8, ty: e!.y - 2 }, { type: "engineer", owner: 0, tx: p!.x + 3, ty: p!.y + 3, count: 3 }, { type: "apc", owner: 0, tx: p!.x + 5, ty: p!.y + 3 }],
      objectives: [{ id: "silo", kind: "captureType", type: "missilesilo", text: "Capture the Missile Silo." }, { id: "timer", kind: "flag", text: "Capture it before launch." }],
      triggers: [
        startMsg("Command: twenty-five minutes. Load the Engineers into the APC."),
        { id: "t", when: { kind: "start" }, actions: [{ kind: "timer", seconds: 1500, label: "Launch window" }] },
        { id: "captured", when: { kind: "objectiveDone", id: "silo" }, actions: [{ kind: "complete", id: "timer" }, { kind: "message", text: "Silo secured. The warhead is ours." }] },
        { id: "razed", when: { kind: "destroyed", owner: 1, type: "missilesilo" }, actions: [{ kind: "complete", id: "silo" }, { kind: "complete", id: "timer" }, { kind: "message", text: "Silo destroyed. The warhead is neutralised." }] },
      ],
    }),
  },
  {
    id: "a13",
    faction: "alliance",
    act: 4,
    index: 13,
    title: "Phase Line",
    briefing: ["Meridian science has finished the Phase Gate. Build it, shift armour behind the Pact line, and break them.", "The Pact will hit you with everything to stop the gate from charging."],
    map: { seed: 9013, width: 80, height: 80, waterAmount: 0.3, oreAmount: 0.8, players: 2 },
    make: ([, e]) => ({
      players: [human("alliance", 12000), enemy("pact", true, "normal", 9000)],
      techLevel: 9,
      actors: base(1, e!, 3, "pact"),
      objectives: [{ id: "gate", kind: "buildType", type: "phasegate", text: "Build the Phase Gate." }, destroyAll(1)],
      triggers: [startMsg("Command: the gate teleports up to five vehicles for twenty seconds. Pick the moment.")],
    }),
  },
  {
    id: "a14",
    faction: "alliance",
    act: 4,
    index: 14,
    title: "Meridian Dawn",
    briefing: ["The Pact capital lies across the river, defended by two commands. Destroy both.", "Everything is unlocked. Finish it."],
    map: { seed: 9014, width: 96, height: 96, waterAmount: 0.4, oreAmount: 0.9, players: 3 },
    make: ([, e1, e2]) => ({
      players: [human("alliance", 15000), enemy("pact", true, "normal", 10000, 1), enemy("pact", true, "easy", 7000, 1, "#8a2a2a")],
      techLevel: 10,
      actors: [...base(1, e1!, 3, "pact"), ...base(2, e2!, 2, "pact"), { type: "missilesilo", owner: 1, tx: e1!.x + 8, ty: e1!.y - 2 }],
      objectives: [destroyAll(1, "Destroy Pact Command."), destroyAll(2, "Destroy the Pact reserve army.")],
      triggers: [startMsg("Command: this is the last one. Good hunting.")],
    }),
  },
];

// ── Ural Pact campaign ───────────────────────────────────────────────────────

const PACT: MissionSpec[] = [
  {
    id: "p01",
    faction: "pact",
    act: 1,
    index: 1,
    title: "First Strike",
    briefing: ["An Alliance observation post sits on our border. Take a rifle company and two Heavy Tanks and remove it.", "No construction support. Crush their infantry under your tracks."],
    map: { seed: 8001, width: 40, height: 40, waterAmount: 0.2, oreAmount: 0.3, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 0), enemy("alliance", false, "easy", 0)],
      noStartingUnits: true,
      techLevel: 1,
      actors: [
        { type: "rifle", owner: 0, tx: p!.x - 2, ty: p!.y, count: 6 },
        { type: "heavytank", owner: 0, tx: p!.x + 1, ty: p!.y + 2, count: 2 },
        { type: "power", owner: 1, tx: e!.x + 2, ty: e!.y - 2 },
        { type: "barracks", owner: 1, tx: e!.x - 3, ty: e!.y - 2 },
        { type: "radar", owner: 1, tx: e!.x, ty: e!.y + 2 },
        { type: "pillbox", owner: 1, tx: e!.x - 4, ty: e!.y + 3 },
        { type: "rifle", owner: 1, tx: e!.x - 2, ty: e!.y + 4, count: 5 },
        { type: "ranger", owner: 1, tx: e!.x + 3, ty: e!.y + 3 },
      ],
      objectives: [{ id: "post", kind: "destroyStructures", owner: 1, text: "Destroy the Alliance observation post." }],
      triggers: [startMsg("Marshal: keep the tanks in front. Infantry follows."), { id: "reinf", when: { kind: "destroyed", owner: 0, count: 3 }, actions: [{ kind: "reinforce", owner: 0, units: [{ type: "grenadier", count: 4 }], tx: p!.x, ty: p!.y, order: "attackMove", toTx: e!.x, toTy: e!.y }] }],
    }),
  },
  {
    id: "p02",
    faction: "pact",
    act: 1,
    index: 2,
    title: "Steel Curtain",
    briefing: ["Deploy the MCV and build a base of operations. An Alliance outpost across the plain must be levelled.", "Flame Towers will hold the perimeter while the War Factory comes up."],
    map: { seed: 8002, width: 48, height: 48, waterAmount: 0.2, oreAmount: 0.6, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 5000), enemy("alliance", true, "easy", 3000)],
      techLevel: 2,
      actors: base(1, e!, 1, "alliance"),
      objectives: [{ id: "fac", kind: "buildType", type: "factory", text: "Build a War Factory." }, destroyAll(1)],
      triggers: [startMsg("Marshal: the Alliance will send Rangers to scout. Kill them."), ...repeatWaves("w", 240, 180, 3, 1, e!, p!, [{ type: "rifle", count: 3 }, { type: "ranger", count: 1 }])],
    }),
  },
  {
    id: "p03",
    faction: "pact",
    act: 1,
    index: 3,
    title: "Dogs of War",
    briefing: ["Alliance spies and infantry are infiltrating our lines. Build a Kennel and let the dogs loose.", "Kill thirty enemy soldiers."],
    map: { seed: 8003, width: 48, height: 48, waterAmount: 0.1, oreAmount: 0.5, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 6000), enemy("alliance", false, "normal", 0)],
      techLevel: 2,
      actors: [{ type: "barracks", owner: 1, tx: e!.x, ty: e!.y }, { type: "power", owner: 1, tx: e!.x + 3, ty: e!.y }],
      objectives: [{ id: "kennel", kind: "buildType", type: "kennel", text: "Build a Kennel." }, { id: "kills", kind: "killCount", count: 30, text: "Kill thirty Alliance soldiers." }],
      triggers: [startMsg("Marshal: dogs kill infantry instantly and see through disguises."), ...repeatWaves("inf", 120, 60, 12, 1, e!, p!, [{ type: "rifle", count: 3 }, { type: "spy", count: 1 }])],
    }),
  },
  {
    id: "p04",
    faction: "pact",
    act: 1,
    index: 4,
    title: "Black Gold",
    briefing: ["Two Oil Derricks in the valley fund the Alliance war effort. Capture both with Engineers and hold them for eight minutes.", "The derricks pay whoever owns them."],
    map: { seed: 8004, width: 56, height: 56, waterAmount: 0.1, oreAmount: 0.5, players: 2 },
    make: ([p, e]) => {
      const mx = Math.floor((p!.x + e!.x) / 2);
      const my = Math.floor((p!.y + e!.y) / 2);
      return {
        players: [human("pact", 5000), enemy("alliance", false, "normal", 0)],
        techLevel: 3,
        actors: [
          { type: "oilderrick", owner: -1, tx: mx - 4, ty: my - 3 },
          { type: "oilderrick", owner: -1, tx: mx + 4, ty: my + 3 },
          { type: "pillbox", owner: 1, tx: mx, ty: my },
          { type: "rifle", owner: 1, tx: mx - 2, ty: my + 2, count: 4 },
          { type: "engineer", owner: 0, tx: p!.x + 3, ty: p!.y + 3, count: 3 },
        ],
        objectives: [{ id: "cap", kind: "captureType", type: "oilderrick", count: 2, text: "Capture both Oil Derricks." }, { id: "hold", kind: "survive", seconds: 480, hidden: true, text: "Hold the derricks for eight minutes." }],
        triggers: [startMsg("Marshal: Engineers capture on contact."), { id: "held", when: { kind: "objectiveDone", id: "cap" }, actions: [{ kind: "activate", id: "hold" }] }, ...repeatWaves("cw", 200, 120, 6, 1, e!, { x: mx, y: my }, [{ type: "lighttank", count: 1 }, { type: "rifle", count: 3 }])],
      };
    },
  },
  {
    id: "p05",
    faction: "pact",
    act: 2,
    index: 5,
    title: "Northern Fleet",
    briefing: ["Alliance Destroyers patrol the strait. Build a Submarine Pen and sink their Naval Yard.", "Submarines surface to fire; keep them out of Gunboat sonar range until they strike."],
    map: { seed: 9005, width: 64, height: 64, waterAmount: 0.5, oreAmount: 0.7, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 8000), enemy("alliance", true, "normal", 6000)],
      techLevel: 4,
      actors: [...base(1, e!, 2, "alliance"), { type: "navalyard", owner: 1, tx: e!.x + 6, ty: e!.y + 6 }, { type: "gunboat", owner: 1, tx: e!.x, ty: e!.y + 12, count: 2 }],
      objectives: [{ id: "pen", kind: "buildType", type: "subpen", text: "Build a Submarine Pen." }, { id: "yard", kind: "destroyType", owner: 1, type: "navalyard", text: "Destroy the Naval Yard." }],
      triggers: [startMsg("Marshal: the pen must touch water.")],
    }),
  },
  {
    id: "p06",
    faction: "pact",
    act: 2,
    index: 6,
    title: "Fire and Ice",
    briefing: ["Alliance armour is massing beyond the ridge. Hold the pass for ten minutes.", "Flame Towers burn infantry; Heavy Tanks and Rocket Soldiers stop the Medium Tanks."],
    map: { seed: 8006, width: 56, height: 56, waterAmount: 0.05, oreAmount: 0.6, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 9000), enemy("alliance", false, "normal", 0)],
      techLevel: 4,
      noStartingUnits: true,
      actors: [{ type: "conyard", owner: 0, tx: p!.x - 1, ty: p!.y - 1 }, { type: "power", owner: 0, tx: p!.x + 3, ty: p!.y - 3 }, { type: "barracks", owner: 0, tx: p!.x - 5, ty: p!.y - 3 }, { type: "factory", owner: 0, tx: p!.x + 1, ty: p!.y + 3 }, { type: "refinery", owner: 0, tx: p!.x - 6, ty: p!.y + 1 }, { type: "oretruck", owner: 0, tx: p!.x - 4, ty: p!.y + 5, order: "harvest" }],
      objectives: [{ id: "hold", kind: "survive", seconds: 600, text: "Hold the pass for ten minutes." }, protectYard()],
      triggers: [startMsg("Marshal: two minutes until contact."), ...repeatWaves("col", 120, 75, 7, 1, e!, p!, [{ type: "mediumtank", count: 2 }, { type: "rifle", count: 3 }, { type: "artillery", count: 0 }])],
    }),
  },
  {
    id: "p07",
    faction: "pact",
    act: 2,
    index: 7,
    title: "Sabotage",
    briefing: ["An Alliance Technology Centre is developing the Phase Gate. Send the Field Officer to plant charges before it comes online.", "Small team, no base. Avoid the camouflaged pillboxes."],
    map: { seed: 8007, width: 48, height: 48, waterAmount: 0.1, oreAmount: 0.3, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 0), enemy("alliance", false, "normal", 0)],
      noStartingUnits: true,
      techLevel: 7,
      actors: [{ type: "officer", owner: 0, tx: p!.x, ty: p!.y }, { type: "shock", owner: 0, tx: p!.x - 1, ty: p!.y + 2, count: 4 }, { type: "heavytank", owner: 0, tx: p!.x + 2, ty: p!.y + 3, count: 2 }, { type: "rifle", owner: 0, tx: p!.x + 1, ty: p!.y + 2, count: 3 }, ...base(1, e!, 1, "alliance"), { type: "techcenter", owner: 1, tx: e!.x + 6, ty: e!.y + 6 }, { type: "camopillbox", owner: 1, tx: e!.x + 4, ty: e!.y + 9 }],
      objectives: [{ id: "tech", kind: "destroyType", owner: 1, type: "techcenter", text: "Destroy the Technology Centre." }, { id: "off", kind: "protect", type: "officer", text: "The Field Officer must survive." }],
      triggers: [startMsg("Marshal: the Officer plants charges on right-click.")],
    }),
  },
  {
    id: "p08",
    faction: "pact",
    act: 2,
    index: 8,
    title: "Arc Light",
    briefing: ["The Arc Tower is ready for field trials. Build two and let the Alliance test them.", "They need full power. Advanced Power Plants first."],
    map: { seed: 8008, width: 56, height: 56, waterAmount: 0.15, oreAmount: 0.6, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 9000), enemy("alliance", true, "easy", 4000)],
      techLevel: 5,
      actors: base(1, e!, 2, "alliance"),
      objectives: [{ id: "arc", kind: "buildType", type: "arctower", count: 2, text: "Build two Arc Towers." }, destroyAll(1)],
      triggers: [startMsg("Marshal: Arc Towers ignore armour. Keep the power on.")],
    }),
  },
  {
    id: "p09",
    faction: "pact",
    act: 3,
    index: 9,
    title: "Red Skies",
    briefing: ["Alliance helicopters harass our columns. Build an Airfield, field two Interceptors, and destroy both Helipads.", "SAM Sites cover the base while the jets hunt."],
    map: { seed: 8009, width: 64, height: 64, waterAmount: 0.15, oreAmount: 0.7, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 10000), enemy("alliance", true, "easy", 5000)],
      techLevel: 6,
      actors: [...base(1, e!, 2, "alliance"), { type: "helipad", owner: 1, tx: e!.x + 6, ty: e!.y + 6 }, { type: "helipad", owner: 1, tx: e!.x - 9, ty: e!.y - 3 }, { type: "longbow", owner: 1, tx: e!.x + 6, ty: e!.y + 6, count: 2 }],
      objectives: [{ id: "mig", kind: "buildType", type: "mig", count: 2, text: "Field two Interceptors." }, { id: "pads", kind: "destroyType", owner: 1, type: "helipad", count: 2, text: "Destroy both Helipads." }, destroyAll(1)],
      triggers: [startMsg("Marshal: jets rearm at the Airfield.")],
    }),
  },
  {
    id: "p10",
    faction: "pact",
    act: 3,
    index: 10,
    title: "Siege of Meridian",
    briefing: ["A fortified Alliance base blocks the road west. Break it.", "Kolossus tanks for the walls, Rocket Launchers for the turrets."],
    map: { seed: 8010, width: 80, height: 80, waterAmount: 0.25, oreAmount: 0.8, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 10000), enemy("alliance", true, "normal", 8000)],
      techLevel: 7,
      actors: base(1, e!, 3, "alliance"),
      objectives: [destroyAll(1)],
      triggers: [startMsg("Marshal: patience. Bleed them at range first.")],
    }),
  },
  {
    id: "p11",
    faction: "pact",
    act: 3,
    index: 11,
    title: "Demolition",
    briefing: ["Three Demolition Trucks are loaded. Drive one into the Alliance Construction Yard.", "No base. Escort them past the turrets."],
    map: { seed: 8011, width: 48, height: 48, waterAmount: 0.1, oreAmount: 0.3, players: 2 },
    make: ([p, e]) => ({
      players: [human("pact", 0), enemy("alliance", false, "normal", 0)],
      noStartingUnits: true,
      techLevel: 8,
      actors: [{ type: "demotruck", owner: 0, tx: p!.x, ty: p!.y, count: 3 }, { type: "heavytank", owner: 0, tx: p!.x - 2, ty: p!.y + 3, count: 3 }, { type: "flaktruck", owner: 0, tx: p!.x + 3, ty: p!.y + 3 }, ...base(1, e!, 2, "alliance")],
      objectives: [{ id: "yard", kind: "destroyType", owner: 1, type: "conyard", text: "Destroy the Alliance Construction Yard." }],
      triggers: [startMsg("Marshal: a Demolition Truck detonates when destroyed or on arrival. Do not bunch them.")],
    }),
  },
  {
    id: "p12",
    faction: "pact",
    act: 4,
    index: 12,
    title: "Iron Curtain",
    briefing: ["The Aegis Field Generator is complete. Build it, shield your armour, and roll over the Alliance line.", "They will counter with Artillery and Cruisers. Hurry."],
    map: { seed: 8012, width: 80, height: 80, waterAmount: 0.35, oreAmount: 0.8, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 12000), enemy("alliance", true, "normal", 9000)],
      techLevel: 9,
      actors: base(1, e!, 3, "alliance"),
      objectives: [{ id: "aegis", kind: "buildType", type: "aegis", text: "Build the Aegis Field Generator." }, destroyAll(1)],
      triggers: [startMsg("Marshal: twenty seconds of invulnerability. Make them count.")],
    }),
  },
  {
    id: "p13",
    faction: "pact",
    act: 4,
    index: 13,
    title: "Countdown",
    briefing: ["Build the Missile Silo and end the Alliance presence in the sector. One warhead every ten minutes.", "They will do anything to stop the launch."],
    map: { seed: 8013, width: 80, height: 80, waterAmount: 0.2, oreAmount: 0.8, players: 2 },
    make: ([, e]) => ({
      players: [human("pact", 12000), enemy("alliance", true, "normal", 9000)],
      techLevel: 10,
      actors: base(1, e!, 3, "alliance"),
      objectives: [{ id: "silo", kind: "buildType", type: "missilesilo", text: "Build the Missile Silo." }, { id: "flat", kind: "destroyStructures", owner: 1, text: "Destroy every Alliance structure." }],
      triggers: [startMsg("Marshal: target their Construction Yard with the first warhead.")],
    }),
  },
  {
    id: "p14",
    faction: "pact",
    act: 4,
    index: 14,
    title: "Ural Sunrise",
    briefing: ["The Alliance capital and its reserve army stand between us and the sea. Destroy both commands.", "Everything is unlocked."],
    map: { seed: 8014, width: 96, height: 96, waterAmount: 0.4, oreAmount: 0.9, players: 3 },
    make: ([, e1, e2]) => ({
      players: [human("pact", 15000), enemy("alliance", true, "normal", 10000, 1), enemy("alliance", true, "easy", 7000, 1, "#2a4a8a")],
      techLevel: 10,
      actors: [...base(1, e1!, 3, "alliance"), ...base(2, e2!, 3, "alliance"), { type: "phasegate", owner: 1, tx: e1!.x + 8, ty: e1!.y - 2 }],
      objectives: [destroyAll(1, "Destroy Alliance Command."), destroyAll(2, "Destroy the Alliance reserve army.")],
      triggers: [startMsg("Marshal: the sun rises in the east. Finish it.")],
    }),
  },
];

export const CAMPAIGN: MissionSpec[] = [...ALLIANCE, ...PACT];

export function missionSpec(id: string): MissionSpec | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}

export function buildMission(spec: MissionSpec, map: MapData): MissionDef {
  const body = spec.make(map.starts);
  return { id: spec.id, faction: spec.faction, act: spec.act, index: spec.index, title: spec.title, briefing: spec.briefing, map: { gen: spec.map }, ...body };
}

const PROGRESS_KEY = "speedrungames:iron-meridian:campaign";

export function loadProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

export function markComplete(id: string): void {
  const done = loadProgress();
  done.add(id);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    // ignore
  }
}

/** A mission is unlocked when it is the first of its campaign or the previous one is done. */
export function isUnlocked(spec: MissionSpec, done: Set<string>): boolean {
  if (spec.index === 1) return true;
  const prev = CAMPAIGN.find((m) => m.faction === spec.faction && m.index === spec.index - 1);
  return !!prev && done.has(prev.id);
}
