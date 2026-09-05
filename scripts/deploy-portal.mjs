#!/usr/bin/env node
// scripts/deploy-portal.mjs — manual deploy fallback (when you can't use CI).
//
// The normal path is: push to main, and .github/workflows/deploy.yml deploys
// automatically. Use this only for a local one-off deploy.
//
// It does NOT copy files itself. It locates a local speedrungames portal
// checkout and runs the portal's canonical ingest:
//
//     node <portal>/scripts/ingest-game-build.mjs --game-dir . --status <status>
//
// Find the portal via --portal <path> or the SPEEDRUNGAMES_PORTAL env var, or
// a sibling ../speedrungames checkout.
//
// Usage:  npm run deploy:portal -- [--status live] [--portal /path/to/speedrungames]

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const status = flag("--status") || "live";
const portal = resolvePortal(flag("--portal") || process.env.SPEEDRUNGAMES_PORTAL);

if (!portal) {
  fail(
    "Could not find a speedrungames portal checkout.\n" +
      "  Pass --portal <path>, set SPEEDRUNGAMES_PORTAL, or clone it as a sibling (../speedrungames).\n" +
      "  Then this runs:  node <portal>/scripts/ingest-game-build.mjs --game-dir . --status " + status,
  );
}

const ingest = resolve(portal, "scripts/ingest-game-build.mjs");
if (!existsSync(ingest)) fail(`Portal found at ${portal} but ${ingest} is missing.`);

if (!existsSync(resolve(REPO, "dist/index.html"))) {
  fail("No dist/index.html — run `npm run build` first.");
}

console.log(`→ Ingesting this game into ${portal} (status=${status}) ...`);
execFileSync("node", [ingest, "--game-dir", REPO, "--status", status], {
  stdio: "inherit",
});
console.log("\n✓ Ingested. Commit the portal change (or let its CI open the PR).");

function resolvePortal(p) {
  const candidates = [p, resolve(REPO, "..", "speedrungames")].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(resolve(c, "scripts/ingest-game-build.mjs"))) return resolve(c);
  }
  return null;
}

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function fail(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}
