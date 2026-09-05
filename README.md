# Iron Meridian

Cold-war alternate-history real-time strategy for the browser, built to mechanical parity with
the 1996 Westwood classic and its open-source re-implementation, with original factions, art,
and audio. Ships to **https://speedrungames.net/games/iron-meridian/** (not yet live).

Two factions: the **Meridian Alliance** (speed, tech, naval range, medics, spies, Phase Gate,
GPS) and the **Ural Pact** (armour, arc weapons, dogs, airpower, Aegis Field, Missile Silo).

- Ore and gem economy, construction-yard base building, sidebar production, power, walls and
  gates, sell and repair, tech tree, crates, neutral oil derricks and hospitals.
- 41 units and 37 structures: full infantry, vehicle, aircraft, and naval rosters with
  capture, heal, disguise, theft, C4, mines, jamming, gap generators, phase jumps, demolition,
  transports, submarines, sonar, ammo and rearming.
- Seven superweapons, fog of war and shroud, three-difficulty skirmish AI with air and navy.
- 28-mission campaign (14 per faction) with briefings, objectives, triggers, timers, and
  reinforcements; unlock progression and score screens.
- 16-map skirmish pool (authored ASCII maps plus named generator presets), saves with
  autosave and quick save, replays, options with rebindable hotkeys and a colour-blind palette.
- 1v1 peer-to-peer lockstep multiplayer over WebRTC with copy/paste signalling (no server).
- Synthesised sound, three procedural music tracks, and voice cues with subtitles.

Scope and status: [`docs/PARITY_SPEC.md`](docs/PARITY_SPEC.md). Current state: [`HANDOFF.md`](HANDOFF.md).

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

## Verify

```bash
npm run verify       # typecheck + relative-path lint + sim-purity lint + unit tests
npm test             # Playwright smoke + liveness gates against the production build
npx vite-node scripts/simulate.ts --quick   # headless AI-vs-AI balance matrix (see docs/SIMULATION.md)
node scripts/analyze.mjs                    # summarise the newest simulation JSON
```

## Controls (classic layout, all rebindable in Options)

Left-click select, drag box-select, right-click move/attack/harvest/enter, `Shift` queue,
`Ctrl`+right-click force fire, `Alt`+right-click force move, `A` attack-move, `F` force-fire
mode, `S` stop, `G` guard, `X` scatter, `D` deploy/unload/phase-jump, `E` all combat units,
`N` idle ore truck, `Z` sell, `R` repair, `Ctrl+0–9` assign group, `0–9` recall, `Space` last
event, `H` home, `F1–F4` bookmarks, `Tab` sidebar tab, `P` pause, `+`/`-` speed, `F5`/`F9`
quick save/load, `M` next track, `Esc` cancel or in-game menu. Walls: pick one in the sidebar
and drag a line. Edge-scroll, arrow keys, middle-drag, and the minimap pan the camera.

## Layout

```
data/           rules: units, structures, weapons, warheads, factions, general (JSON, zod-validated)
src/sim/        deterministic 20 Hz simulation (no DOM, no wall-clock, no Math.random; linted)
src/sim/mission.ts   objective/trigger engine   src/sim/maps.ts   map pool + ASCII format
src/data/campaign.ts 28 missions                src/sim/serialize.ts saves + replays
src/view/       canvas renderer, input, camera, sidebar, menus, options, audio, music, multiplayer
tests/          vitest unit tests, Playwright smoke and liveness gates
docs/           PARITY_SPEC.md, DEPLOYMENT_PATH.md
retired/        superseded code, staged not deleted (see retired/README.md)
```

## Deploy

Push to `main`; CI builds and opens an auto-merging portal PR. Details, preconditions, and the
one-time repo-creation steps: [`docs/DEPLOYMENT_PATH.md`](docs/DEPLOYMENT_PATH.md).
Builder rules: [`AGENTS.md`](AGENTS.md). Assets: [`ASSETS.md`](ASSETS.md) (none shipped).
