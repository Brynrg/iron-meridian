#!/usr/bin/env node
// Summarise a scripts/out/simulate-*.json into balance stats and anomalies.
// Usage: node scripts/analyze.mjs [path.json]   (default: newest file in scripts/out)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "scripts/out";
const file = process.argv[2] ?? join(dir, readdirSync(dir).filter((f) => f.startsWith("simulate-") && f.endsWith(".json")).sort().pop());
const d = JSON.parse(readFileSync(file, "utf8"));
const games = [...d.cells.flatMap((c) => c.results), ...d.poolRuns.flatMap((c) => c.results ?? [c])].filter((g) => g && g.players);

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`# ${file}`);
console.log(`games: ${games.length}   wall: ${Math.round(d.wallTimeMs / 1000)}s   cap: ${d.maxTicks / 1200} min`);

// Win rates by matchup and difficulty.
const groups = new Map();
for (const g of games) {
  const key = `${g.config.factionA}-${g.config.factionB} ${g.config.difficultyA}`;
  const a = groups.get(key) ?? { n: 0, a: 0, b: 0, draw: 0, dur: [] };
  a.n++;
  if (g.winnerTeam === 0) a.a++;
  else if (g.winnerTeam === 1) a.b++;
  else a.draw++;
  a.dur.push(g.durationGameMinutes);
  groups.set(key, a);
}
console.log("\n## Outcomes by cell (A wins / B wins / draws, mean minutes)");
for (const [k, v] of [...groups.entries()].sort()) console.log(`${k.padEnd(30)} ${v.a}/${v.b}/${v.draw}  ${mean(v.dur).toFixed(1)}`);

// Faction totals across mixed matchups only.
let aw = 0, pw = 0, mixed = 0, decided = 0;
for (const g of games) {
  if (g.config.factionA === g.config.factionB) continue;
  mixed++;
  if (g.winnerFaction === "alliance") aw++, decided++;
  else if (g.winnerFaction === "pact") pw++, decided++;
}
console.log(`\n## Mixed matchups: ${mixed} games, decided ${decided} (${pct(decided, mixed)}); alliance ${aw} (${pct(aw, decided)}), pact ${pw} (${pct(pw, decided)})`);

// Economy and army by faction/difficulty.
console.log("\n## Per side means: harvested, built, lost, kills, units alive, structures alive, army value");
const side = new Map();
for (const g of games) for (const [i, p] of g.players.entries()) {
  const diff = i === 0 ? g.config.difficultyA : g.config.difficultyB;
  const key = `${p.faction} ${diff}`;
  const s = side.get(key) ?? { n: 0, h: [], b: [], l: [], k: [], u: [], s: [], av: [] };
  s.n++; s.h.push(p.harvested); s.b.push(p.built); s.l.push(p.lost); s.k.push(p.kills); s.u.push(p.unitsAlive); s.s.push(p.structuresAlive); s.av.push(p.armyValue);
  side.set(key, s);
}
for (const [k, s] of [...side.entries()].sort()) console.log(`${k.padEnd(18)} n=${s.n}  ${Math.round(mean(s.h))}  ${mean(s.b).toFixed(1)}  ${mean(s.l).toFixed(1)}  ${mean(s.k).toFixed(1)}  ${mean(s.u).toFixed(1)}  ${mean(s.s).toFixed(1)}  ${Math.round(mean(s.av))}`);

// Timeline: mean credits + army value per minute per faction (mixed games).
console.log("\n## Timeline (mixed games): minute -> alliance credits/army | pact credits/army");
const tl = new Map();
for (const g of games) {
  if (g.config.factionA === g.config.factionB) continue;
  for (const s of g.timeline) {
    const min = Math.round((s.gameSeconds + 1) / 60);
    const row = tl.get(min) ?? { a: [], aa: [], p: [], pa: [] };
    for (const [i, ps] of s.players.entries()) {
      const fac = i === 0 ? g.config.factionA : g.config.factionB;
      if (fac === "alliance") row.a.push(ps.credits), row.aa.push(ps.armyValue);
      else row.p.push(ps.credits), row.pa.push(ps.armyValue);
    }
    tl.set(min, row);
  }
}
for (const [m, r] of [...tl.entries()].sort((x, y) => x[0] - y[0])) if (m % 2 === 0) console.log(`${String(m).padStart(3)}  ${Math.round(mean(r.a))}/${Math.round(mean(r.aa))} | ${Math.round(mean(r.p))}/${Math.round(mean(r.pa))}`);

// Anomalies.
console.log("\n## Anomalies");
let any = false;
for (const g of games) {
  const [p0, p1] = g.players;
  const flags = [];
  if (p0.harvested < 3000 || p1.harvested < 3000) flags.push(`economy stall (${p0.harvested}/${p1.harvested})`);
  if (p0.kills === 0 && p1.kills === 0 && g.durationGameMinutes >= 8) flags.push("no contact");
  for (const [i, p] of [p0, p1].entries()) {
    const other = i === 0 ? p1 : p0;
    if (g.winnerTeam === -1 && p.unitsAlive === 0 && p.structuresAlive <= 3 && other.unitsAlive >= 8) flags.push(`unfinished kill (side ${i} down to ${p.structuresAlive} structures)`);
  }
  if (flags.length) {
    any = true;
    console.log(`- ${g.config.label}: ${flags.join("; ")}`);
  }
}
if (!any) console.log("- none");
