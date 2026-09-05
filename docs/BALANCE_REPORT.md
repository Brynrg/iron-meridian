# Balance Report — 2026-09-05

Headless AI-vs-AI simulation of the shipped rules, before and after the fixes made during the
first simulation pass. Drafted by the local coder model from the analyzer outputs and corrected
against them; every number below is copied from `scripts/out/baseline-analysis.txt` (before) and
`scripts/out/final-analysis.txt` (after).

## Method

- Harness: `scripts/simulate.ts` (see `docs/SIMULATION.md`). Both sides are the built-in AI.
- Matrix: alliance/pact in all four pairings × easy/normal/hard × 3 seeds (36 games) plus each
  2-player map in the pool at normal/normal (7 games) = 43 games.
- Cap: 25 **game** minutes (30,000 ticks at 20 Hz); a game that has not decided by then is a draw.
- Seeds are fixed, and the sim is deterministic, so a difference between runs is caused by code
  or data changes, not noise.

## Before vs after

| Metric | Before | After |
|---|---|---|
| Mixed-faction games decided within the cap | 8 of 25 (32 %) | 11 of 25 (44 %) |
| Alliance / Pact share of decided mixed games | 38 % / 63 % | 55 % / 45 % |
| Economy-stall games (a side harvested < 3,000) | 9 | 0 |
| No-contact games (0 kills both sides after 8 min) | 1 | 0 |
| Unfinished-kill games (winner idle with the loser at ≤ 3 structures) | 0 (masked by stalls) | 3 |
| Mean harvested, alliance at normal | 21,076 | 32,970 |
| Mean harvested, pact at normal | 16,245 | 31,840 |
| Mean army value at end, alliance / pact at normal | 7,611 / 3,389 | 8,953 / 5,908 |

## What changed between the runs

1. The AI no longer halts building and production while its base is under attack (it returned
   early for 15 s after every hit).
2. Placement rejects cells that are another building's exit or dock, rejects a building whose own
   dock would be blocked, and the refinery's free truck spawns at a genuinely free exit cell.
3. Ground units embedded inside a footprint are pushed to the nearest free cell.
4. Long-range ore search skips fields within 8 cells of enemy structures; trucks remember
   unreachable fields and check reachability before committing.
5. The map generator's water coverage now follows the `waterAmount` setting through a noise
   quantile (Frozen Lake went from 0 % to 17 % water).
6. AI island detection starts from passable cells; a cut-off base with no shoreline goes air-first;
   a structure type that cannot be placed is skipped for two minutes instead of retried forever.
7. The AI attacks with any force once every enemy is down to ≤ 4 structures and ≤ 3 armed units;
   late-game wave-threshold growth is capped.
8. AI placement refuses spots that would seal the yard's doorstep or any producer's exit
   (bases used to wall in their own barracks), and new units spawn on a cell connected to the rally
   point. Economy buildings may still be placed non-strictly if nothing else fits.
9. River Crossing's two starting ore fields were enlarged symmetrically.

## Remaining balance observations (after run)

- **Pact trades worse.** At normal the Pact loses 49.5 units per game to the Alliance's 34.8 while
  scoring fewer kills (36.0 vs 47.7); at hard it loses 62.2 for 56.8 kills. Its end-of-game army
  value is lower at every difficulty (normal 5,908 vs 8,953).
- **Economies are now close.** Harvested at normal: 32,970 vs 31,840. The gap is in how the
  income is spent, not in the income.
- **Win share is near even** (6 vs 5 in decided mixed games) despite the trade gap, because the
  Pact's heavier units survive long enough to close games it starts winning.
- **Hard is the most decisive setting** (5 of 6 mixed hard games decided); normal and easy still
  draw more often than they finish inside 25 minutes.

## Open anomalies

Three unfinished kills remain in the after run: `pact-alliance easy seed=1020`,
`pact-alliance hard seed=1024`, `pact-alliance hard seed=1026`. In each, one side has a large idle
army while the other is down to one or two structures. The base-sealing cause was fixed for the
previously affected seeds; these should be traced the same way (replay the seed, print the
leftover structures, the winner's army orders, and a path check from the army to the target).
The likely remaining cause is a last structure the ground army cannot path to (behind the
enemy's own buildings or on a shore), which the "finish the job" rule cannot solve without
artillery, air, or engineers. A second pass should give the AI a "siege" behaviour: when the last
targets are unreachable by ground, queue artillery/rocket launchers or aircraft and target them.

## Reproduce

```bash
npx vite-node scripts/simulate.ts        # ~7 minutes on an M5 Max
node scripts/analyze.mjs                 # newest scripts/out/simulate-*.json
```
