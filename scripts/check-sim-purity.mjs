#!/usr/bin/env node
// Enforces the sim/view boundary: nothing under src/sim may touch the DOM,
// the wall clock, or Math.random. Determinism depends on it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/sim";
const BANNED = [
  [/\bdocument\b/, "document"],
  [/\bwindow\b/, "window"],
  [/\bMath\.random\b/, "Math.random"],
  [/\bDate\.now\b|new Date\(/, "Date"],
  [/\bperformance\.now\b/, "performance.now"],
  [/\brequestAnimationFrame\b/, "requestAnimationFrame"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bconsole\./, "console"],
];
const offenders = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) {
      const src = readFileSync(p, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const [re, name] of BANNED) if (re.test(line)) offenders.push(`${p}:${i + 1} uses ${name}`);
      });
    }
  }
}
walk(ROOT);
if (offenders.length) {
  console.error("\u2717 sim purity violations:\n  " + offenders.join("\n  "));
  process.exit(1);
}
console.log("\u2713 check-sim-purity: src/sim is free of DOM, wall-clock, and Math.random");
