# HANDOFF — Iron Meridian

Supersedes: the v0.3.0 handoff written earlier on 2026-09-05. Written 2026-09-05 (later the same day).

## Canonical project
- Source: `~/Code/games/iron-meridian`, remote `https://github.com/Brynrg/iron-meridian` (branch `main`).
- Deployed: commit `558d672` (v1.0.0) ingested by portal PR
  [Brynrg/speedrungames#166](https://github.com/Brynrg/speedrungames/pull/166), merged
  2026-09-05 21:23 UTC as `c33e9fc`; Netlify production deploy `state: ready`.
- Live: https://speedrungames.net/games/iron-meridian/ (manifest v1.0.0, status live, listed on the homepage).
- Portal: `~/Code/games/speedrungames` (`Brynrg/speedrungames`, Netlify site
  `71683967-2b9c-4227-8fec-0ae0d41ef0d9`). Deploy path: `docs/DEPLOYMENT_PATH.md`.

## Authority exercised / withheld
| Boundary | State |
|---|---|
| Folder creation, implementation, tests | Exercised |
| Commit + push to `main` | Exercised after the owner's "you can do it" |
| GitHub repo creation, `SPEEDRUNGAMES_TOKEN` secret, first deploy | Exercised on the same authorization (secret piped from Keychain to `gh secret set`; value never displayed) |
| Portal checkout | Read only; not modified |

## What exists (v1.0.0)
Feature-parity checklist: `docs/PARITY_SPEC.md` (57 rows done, 3 partial: hierarchical
pathfinding, lavish art, keyboard-only play).

- **Sim** (`src/sim`, deterministic 20 Hz, purity-linted): economy with cash/ore split, base
  building with base radius, walls drawn as lines, gates, sell/repair, primary/rally, tech
  gating; full roster of 41 units and 37 structures incl. mines, jammers, gap, phase tank,
  demolition trucks, transports, aircraft with ammo/rearm, submarines with cloak/detect/sonar;
  weapons/warheads/armour with splash, prone, crush; all seven superweapons (phase with
  return, aegis, nuke, recon, paradrop, sonar, GPS); fog/shroud; crates; neutral derricks,
  hospital, civilians; three-difficulty AI with navy and air; short/long game victory;
  save/load; replay log; mission engine with 11 objective kinds and 19 trigger actions.
- **Content**: 28 missions (`src/data/campaign.ts`), 16-map pool with an ASCII map format
  (`src/sim/maps.ts`), original voice lines, three procedural music tracks.
- **View** (`src/view`): renderer with autotiled terrain, decals, fire/smoke, ammo pips;
  classic sidebar; full hotkey scheme, all rebindable; options; menus for skirmish, campaign
  (unlock progression, briefings, next/retry), load/save slots, replay, multiplayer lobby.
- **Multiplayer**: 1v1 WebRTC lockstep with copy/paste signalling (no server), 4-tick input
  delay, per-second hash comparison. Manifest declares `multiplayer: p2p / webrtc`.

## Evidence (2026-09-05, local)
| Check | Result |
|---|---|
| `npm run verify` (typecheck + path lint + sim-purity lint + 16 vitest) | Pass |
| `npm run build` (~280 kB JS) | Pass |
| `npx playwright test` (smoke + 5 liveness gates: skirmish economy, sidebar, mission boot, save/load, menu→campaign→mission) | Pass |
| Visual in the app browser: main menu, mission a02 with objectives panel, River Crossing skirmish | Pass |
| Multiplayer end-to-end between two real browsers | **Not Proven** (needs two machines/tabs and a human to paste codes; the lockstep scheduler and hash check are unit-level only) |
| Full campaign playthrough by a human | Not Proven (every mission boots and runs 3 s in tests; balance and pacing unplayed) |
| Game repo CI (typecheck, build, path lint, Playwright) on GitHub | Pass (run 33992837569) |
| Reusable deploy workflow → portal PR #166 → auto-merge | Pass (run 33992837957) |
| Netlify production deploy for merge `c33e9fc` | Pass (`state: ready`, verified by deploy state, not URL polling) |
| Live URL serves index + 278 kB bundle, manifest v1.0.0 `live`, homepage lists the game | Pass (curl + app browser, 2026-09-05) |
| Balance harness: 43 AI-vs-AI games, 25 game-minute cap, baseline vs final (`docs/BALANCE_REPORT.md`) | Pass (see report; 3 residual unfinished-kill anomalies documented) |

## Simulation pass (2026-09-05, after deploy; local coder model used for drafting)
`scripts/simulate.ts` (written by the local `code` role from an API brief, then corrected)
runs a 43-game AI-vs-AI matrix; `scripts/analyze.mjs` summarises it. Baseline vs final is in
`docs/BALANCE_REPORT.md`. Defects found and fixed by tracing anomalies: AI froze all
production for 15 s after every hit; AI built over refinery docks (trucks boxed in);
trucks looped on unreachable fields; water presets generated ~0% water; island detection
started from occupied cells; unplaceable buildings retried forever; late-game wave threshold
grew past reachable army sizes; AI bases sealed their own producers' exits; River Crossing
ore was too small. Anomalies dropped from 10/43 games to 3/43 (all of one class, documented in the report).

## Exact next action
1. Playtest: a human should play A1–A3 and P1–P3 and log balance notes; then the AI on
   Hard for 20 minutes.
2. Multiplayer: two browsers, exchange codes, confirm no DESYNC toast over 10 minutes.

## Known limitations
- Art is functional vector work; a dedicated art pass (F3) would lift it.
- Pathfinding is flat A* with an 18k-node budget; fine up to 128² but not hierarchical.
- Multiplayer has no reconnect and no spectator; signalling is manual by design (no server).
- Balance numbers approximate the classic and are untuned by play.
- The desktop app's browser pane reports `document.hidden = true`, so the sim only advances
  there when a screenshot forces a paint; real tabs and Playwright are unaffected.

## Dirty files
None after this commit. `retired/2026-09-05-template-docs/` holds the template's own status
docs (ledger in `retired/README.md`). The portal checkout at `~/Code/games/speedrungames`
was not modified and is now behind `origin/main` (PR #166 landed remotely).
