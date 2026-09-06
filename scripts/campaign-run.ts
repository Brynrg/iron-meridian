// Plays every campaign mission headlessly with the skirmish AI standing in for the
// human, to prove each mission has a reachable end point. Usage:
//   npx vite-node scripts/campaign-run.ts [--only a01,p03] [--minutes 45] [--difficulty hard]
import { loadRules } from "../src/data/rules";
import { generateMap } from "../src/sim/mapgen";
import { createMission, stepSim } from "../src/sim/index";
import { buildMission, CAMPAIGN } from "../src/data/campaign";
import { mkdirSync, writeFileSync } from "node:fs";

const rules = loadRules();
const args = process.argv.slice(2);
const flag = (n: string): string | null => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? null) : null; };
const only = flag("--only")?.split(",") ?? null;
const minutes = Number(flag("--minutes") ?? 45);
const difficulty = (flag("--difficulty") ?? "hard") as "easy" | "normal" | "hard";
const campaign = (flag("--campaign") ?? "normal") as "easy" | "normal" | "hard";

interface Row { id: string; title: string; outcome: "win" | "lose" | "timeout"; minutes: number; objectives: Record<string, string>; fired: string[]; p0: { built: number; lost: number; kills: number; harvested: number }; enemiesLeft: number }
const rows: Row[] = [];
for (const spec of CAMPAIGN) {
  if (only && !only.includes(spec.id)) continue;
  const map = generateMap({ ...spec.map });
  const def = buildMission(spec, map);
  const s = createMission(rules, map, def, campaign);
  const p0 = s.players[0]!;
  p0.isAI = true; p0.difficulty = difficulty;
  p0.ai = { phase: 0, nextThinkTick: 0, attackWaveAt: 0, rallyX: 0, rallyY: 0, targetX: -1, targetY: -1, attacking: false, lastBaseAttackTick: -100000, buildOrderIdx: 0, failedPlacements: 0, blocked: [], blockedClearTick: 0 };
  const cap = Math.round(minutes * 1200);
  const t0 = Date.now();
  while (!s.finished && s.tick < cap) stepSim(s, []);
  const outcome: Row["outcome"] = s.finished ? (s.winner === 0 ? "win" : "lose") : "timeout";
  const enemiesLeft = [...s.actors.values()].filter((a) => a.owner > 0 && (a.kind === "structure" || a.kind === "unit")).length;
  const row: Row = { id: spec.id, title: spec.title, outcome, minutes: +(s.tick / 1200).toFixed(1), objectives: s.mission?.status ?? {}, fired: s.mission?.fired ?? [], p0: p0.stats, enemiesLeft };
  rows.push(row);
  console.log(`${spec.id.padEnd(4)} ${spec.title.padEnd(22)} ${outcome.padEnd(7)} ${String(row.minutes).padStart(5)}m  obj=${JSON.stringify(row.objectives)}  p0 built/lost/kills=${p0.stats.built}/${p0.stats.lost}/${p0.stats.kills} enemiesLeft=${enemiesLeft} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
mkdirSync("scripts/out", { recursive: true });
writeFileSync(`scripts/out/campaign-run-${campaign}.json`, JSON.stringify({ difficulty, campaign, minutes, rows }, null, 2));
const wins = rows.filter((r) => r.outcome === "win").length;
console.log(`\n[campaign ${campaign}] ${wins}/${rows.length} missions reach a win; ${rows.filter((r) => r.outcome === "lose").length} lose; ${rows.filter((r) => r.outcome === "timeout").length} time out`);
