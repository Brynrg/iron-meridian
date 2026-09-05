import { loadRules } from "../src/data/rules";
import { generateMap } from "../src/sim/mapgen";
import { buildMap, MAP_POOL } from "../src/sim/maps";
import { DEFAULT_OPTIONS, createSkirmish, stepSim } from "../src/sim/index";
import type { SimState } from "../src/sim/types";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Faction = "alliance" | "pact";
type Difficulty = "easy" | "normal" | "hard";

interface Setup {
  name: string;
  faction: Faction;
  color: string;
  isAI: boolean;
  difficulty?: Difficulty;
  team?: number;
}

interface GameConfig {
  label: string;
  factionA: Faction;
  factionB: Faction;
  difficultyA: Difficulty;
  difficultyB: Difficulty;
  seed: number;
  mapId: string;
  mapName: string;
  isPool: boolean;
}

interface PlayerEndStats {
  name: string;
  faction: Faction;
  team: number;
  credits: number;
  defeated: boolean;
  harvested: number;
  built: number;
  lost: number;
  kills: number;
  unitsAlive: number;
  structuresAlive: number;
  armyValue: number;
}

interface TimelineSample {
  gameSeconds: number;
  players: Array<{
    team: number;
    credits: number;
    armyValue: number;
  }>;
}

interface GameResult {
  config: GameConfig;
  winnerFaction: Faction | "draw";
  winnerTeam: number;
  durationGameMinutes: number;
  players: PlayerEndStats[];
  timeline: TimelineSample[];
}

interface MatrixCell {
  factionA: Faction;
  factionB: Faction;
  difficulty: Difficulty;
  results: GameResult[];
}

interface Report {
  generatedAt: string;
  wallTimeMs: number;
  quick: boolean;
  gamesOverride: number | null;
  only: string | null;
  maxTicks: number;
  cells: MatrixCell[];
  poolRuns: GameResult[];
  totals: {
    games: number;
    allianceWins: number;
    pactWins: number;
    draws: number;
    avgDurationGameMinutes: number;
  };
}

const TICKS_PER_SECOND = 20;
const SECONDS_PER_MINUTE = 60;
const SAMPLE_INTERVAL_TICKS = TICKS_PER_SECOND * SECONDS_PER_MINUTE;

const FACTIONS: Faction[] = ["alliance", "pact"];
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

function parseArgs(argv: string[]): {
  quick: boolean;
  games: number | null;
  only: string | null;
} {
  let quick = false;
  let games: number | null = null;
  let only: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--quick") {
      quick = true;
    } else if (arg === "--games") {
      const next = argv[i + 1];
      if (next !== undefined) {
        const parsed = Number.parseInt(next, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          games = parsed;
        }
        i++;
      }
    } else if (arg === "--only") {
      const next = argv[i + 1];
      if (next !== undefined) {
        only = next;
        i++;
      }
    }
  }

  return { quick, games, only };
}

function matchesOnly(
  factionA: Faction,
  factionB: Faction,
  only: string | null
): boolean {
  if (only === null) return true;
  const normalized = only.toLowerCase();
  const forward = `${factionA}-${factionB}`;
  const reverse = `${factionB}-${factionA}`;
  return normalized === forward || normalized === reverse;
}

function makeSetup(
  index: number,
  faction: Faction,
  difficulty: Difficulty,
  team: number
): Setup {
  const color = index === 0 ? "#3b82f6" : "#ef4444";
  return {
    name: `${faction}-${index}`,
    faction,
    color,
    isAI: true,
    difficulty,
    team,
  };
}

function countAliveByKind(
  state: SimState,
  owner: number,
  kind: "unit" | "structure"
): number {
  let count = 0;
  state.actors.forEach((actor) => {
    if (actor.owner === owner && actor.kind === kind) {
      count++;
    }
  });
  return count;
}

function computeArmyValue(state: SimState, owner: number): number {
  let value = 0;
  state.actors.forEach((actor) => {
    if (actor.owner !== owner || actor.kind !== "unit") return;
    const unitDef = state.rules.units[actor.type];
    if (unitDef === undefined) return;
    const hasWeapon = unitDef.weapons.length > 0;
    if (hasWeapon) {
      value += unitDef.cost;
    }
  });
  return value;
}

function sampleTimeline(
  state: SimState,
  gameSeconds: number
): TimelineSample {
  const players: TimelineSample["players"] = [];
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    if (player === undefined) continue;
    players.push({
      team: player.team,
      credits: player.credits,
      armyValue: computeArmyValue(state, i),
    });
  }
  return { gameSeconds, players };
}

function runGame(
  config: GameConfig,
  rules: ReturnType<typeof loadRules>,
  maxTicks: number,
  startingCredits: number
): GameResult {
  let map;
  if (config.isPool) {
    const entry = MAP_POOL.find((e) => e.id === config.mapId);
    if (entry === undefined) {
      throw new Error(`Map pool entry not found: ${config.mapId}`);
    }
    map = buildMap(entry, 2);
  } else {
    map = generateMap({
      seed: config.seed,
      width: 64,
      height: 64,
      players: 2,
      waterAmount: 0.3,
      oreAmount: 0.6,
    });
  }

  const setups: Setup[] = [
    makeSetup(0, config.factionA, config.difficultyA, 0),
    makeSetup(1, config.factionB, config.difficultyB, 1),
  ];

  const options = {
    ...DEFAULT_OPTIONS,
    startingCredits,
    shortGame: false,
    crates: true,
  };

  const state = createSkirmish(rules, map, setups, options, config.seed);

  const timeline: TimelineSample[] = [];
  let lastSampleTick = -1;

  let tick = 0;
  while (!state.finished && tick < maxTicks) {
    stepSim(state, []);
    tick++;

    if (tick - lastSampleTick >= SAMPLE_INTERVAL_TICKS) {
      lastSampleTick = tick;
      const gameSeconds = Math.floor(tick / TICKS_PER_SECOND);
      timeline.push(sampleTimeline(state, gameSeconds));
    }
  }

  const durationGameMinutes = tick / TICKS_PER_SECOND / SECONDS_PER_MINUTE;

  const players: PlayerEndStats[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    if (player === undefined) continue;
    players.push({
      name: player.name,
      faction: player.faction,
      team: player.team,
      credits: player.credits,
      defeated: player.defeated,
      harvested: player.stats.harvested,
      built: player.stats.built,
      lost: player.stats.lost,
      kills: player.stats.kills,
      unitsAlive: countAliveByKind(state, i, "unit"),
      structuresAlive: countAliveByKind(state, i, "structure"),
      armyValue: computeArmyValue(state, i),
    });
  }

  let winnerFaction: Faction | "draw" = "draw";
  const winnerTeam = state.winner;
  if (winnerTeam !== -1) {
    const winnerPlayer = state.players[winnerTeam];
    if (winnerPlayer !== undefined) {
      winnerFaction = winnerPlayer.faction;
    }
  }

  return {
    config,
    winnerFaction,
    winnerTeam,
    durationGameMinutes,
    players,
    timeline,
  };
}

function buildMatrixConfigs(
  seedsPerCell: number,
  only: string | null
): GameConfig[] {
  const configs: GameConfig[] = [];
  let seedCounter = 1000;

  for (const factionA of FACTIONS) {
    for (const factionB of FACTIONS) {
      if (!matchesOnly(factionA, factionB, only)) continue;
      for (const difficulty of DIFFICULTIES) {
        for (let s = 0; s < seedsPerCell; s++) {
          const seed = seedCounter++;
          configs.push({
            label: `${factionA}-${factionB} ${difficulty} seed=${seed}`,
            factionA,
            factionB,
            difficultyA: difficulty,
            difficultyB: difficulty,
            seed,
            mapId: "generated",
            mapName: "generated",
            isPool: false,
          });
        }
      }
    }
  }

  return configs;
}

function buildPoolConfigs(only: string | null): GameConfig[] {
  const configs: GameConfig[] = [];
  for (const entry of MAP_POOL) {
    if (entry.players !== 2) continue;
    if (!matchesOnly("alliance", "pact", only)) continue;
    configs.push({
      label: `pool:${entry.id} normal/normal`,
      factionA: "alliance",
      factionB: "pact",
      difficultyA: "normal",
      difficultyB: "normal",
      seed: 0,
      mapId: entry.id,
      mapName: entry.name,
      isPool: true,
    });
  }
  return configs;
}

function printTable(results: GameResult[], poolRuns: GameResult[]): void {
  const all = [...results, ...poolRuns];
  if (all.length === 0) {
    console.log("No games run.");
    return;
  }

  const header =
    "Label".padEnd(36) +
    "Winner".padEnd(12) +
    "Dur(min)".padEnd(10) +
    "P0(harv/built/lost/kills)".padEnd(28) +
    "P1(harv/built/lost/kills)".padEnd(28) +
    "P0(units/structs/army)".padEnd(24) +
    "P1(units/structs/army)";

  console.log(header);
  console.log("-".repeat(header.length));

  for (const result of all) {
    const label = result.config.label.slice(0, 35).padEnd(36);
    const winner = result.winnerFaction.padEnd(12);
    const dur = result.durationGameMinutes.toFixed(1).padEnd(10);

    const p0 = result.players[0];
    const p1 = result.players[1];

    const p0Stats =
      p0 !== undefined
        ? `${p0.harvested}/${p0.built}/${p0.lost}/${p0.kills}`.padEnd(28)
        : "n/a".padEnd(28);
    const p1Stats =
      p1 !== undefined
        ? `${p1.harvested}/${p1.built}/${p1.lost}/${p1.kills}`.padEnd(28)
        : "n/a".padEnd(28);

    const p0End =
      p0 !== undefined
        ? `${p0.unitsAlive}/${p0.structuresAlive}/${p0.armyValue}`.padEnd(24)
        : "n/a".padEnd(24);
    const p1End =
      p1 !== undefined
        ? `${p1.unitsAlive}/${p1.structuresAlive}/${p1.armyValue}`.padEnd(24)
        : "n/a".padEnd(24);

    console.log(`${label}${winner}${dur}${p0Stats}${p1Stats}${p0End}${p1End}`);
  }
}

function main(): void {
  const { quick, games, only } = parseArgs(process.argv.slice(2));

  const seedsPerCell = quick ? 1 : 3;
  const maxTicks = quick
    ? TICKS_PER_SECOND * SECONDS_PER_MINUTE * 10
    : TICKS_PER_SECOND * SECONDS_PER_MINUTE * 25;
  const startingCredits = 10000;

  const rules = loadRules();

  const matrixConfigs = buildMatrixConfigs(seedsPerCell, only);
  const poolConfigs = buildPoolConfigs(only);

  let allConfigs = [...matrixConfigs, ...poolConfigs];

  if (games !== null) {
    allConfigs = allConfigs.slice(0, games);
  }

  const hrStart = process.hrtime();

  const matrixResults: GameResult[] = [];
  const poolResults: GameResult[] = [];

  for (const config of allConfigs) {
    const result = runGame(config, rules, maxTicks, startingCredits);
    if (config.isPool) {
      poolResults.push(result);
    } else {
      matrixResults.push(result);
    }
  }

  const hrEnd = process.hrtime(hrStart);
  const wallTimeMs = hrEnd[0] * 1000 + hrEnd[1] / 1e6;

  const cells: MatrixCell[] = [];
  for (const factionA of FACTIONS) {
    for (const factionB of FACTIONS) {
      for (const difficulty of DIFFICULTIES) {
        const cellResults = matrixResults.filter(
          (r) =>
            r.config.factionA === factionA &&
            r.config.factionB === factionB &&
            r.config.difficultyA === difficulty &&
            r.config.difficultyB === difficulty
        );
        if (cellResults.length > 0) {
          cells.push({
            factionA,
            factionB,
            difficulty,
            results: cellResults,
          });
        }
      }
    }
  }

  let allianceWins = 0;
  let pactWins = 0;
  let draws = 0;
  let totalDuration = 0;
  const allResults = [...matrixResults, ...poolResults];

  for (const result of allResults) {
    if (result.winnerFaction === "alliance") allianceWins++;
    else if (result.winnerFaction === "pact") pactWins++;
    else draws++;
    totalDuration += result.durationGameMinutes;
  }

  const avgDuration =
    allResults.length > 0 ? totalDuration / allResults.length : 0;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    wallTimeMs,
    quick,
    gamesOverride: games,
    only,
    maxTicks,
    cells,
    poolRuns: poolResults,
    totals: {
      games: allResults.length,
      allianceWins,
      pactWins,
      draws,
      avgDurationGameMinutes: avgDuration,
    },
  };

  printTable(matrixResults, poolResults);

  console.log(`\nTotal games: ${allResults.length}`);
  console.log(`Alliance wins: ${allianceWins}`);
  console.log(`Pact wins: ${pactWins}`);
  console.log(`Draws: ${draws}`);
  console.log(`Avg duration: ${avgDuration.toFixed(2)} game minutes`);
  console.log(`Wall time: ${wallTimeMs.toFixed(0)} ms`);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });

  const timestamp = Date.now();
  const outPath = join(outDir, `simulate-${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`JSON written to ${outPath}`);
}

main();
