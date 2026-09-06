# Headless Balance Simulation

> Drafted by the local coder model from the harness source and reviewed against `src/sim/state.ts` on 2026-09-05.

## Purpose
The headless balance harness runs automated skirmish games to evaluate faction balance, economy pacing, and AI performance without a UI. It generates a JSON report containing raw game data, which is then summarized into human-readable statistics and anomaly flags.

## Commands

### Run Simulation
```bash
npx vite-node scripts/simulate.ts [flags]
```
*   `--quick`: Runs a reduced set of games for faster feedback.
*   `--games N`: Overrides the default number of games per matrix cell.
*   `--only a-b`: Restricts the run to a specific matchup (e.g., `alliance-pact`).

### Analyze Results
```bash
node scripts/analyze.mjs [file]
```
*   `[file]`: Path to a specific JSON report. If omitted, the newest file in `scripts/out` is used.

## The Matrix
The simulation covers a matrix of:
*   **Factions**: `alliance` vs `pact` (including mirror matches).
*   **Difficulties**: `easy`, `normal`, `hard`.
*   **Maps**: A pool of generated maps (`MAP_POOL`).

Each cell in the matrix runs multiple games (default or `--games` count) to gather statistical significance.

## Output Columns (Analyze Output)
The `analyze.mjs` script prints several tables. Key columns include:
*   **Outcomes**: `A wins / B wins / draws` and mean duration in minutes.
*   **Per Side Means**:
    *   `harvested`: Total resources collected.
    *   `built`: Structures placed (`stats.built` increments in `spawnStructure`).
    *   `lost`: Units **and** structures lost.
    *   `kills`: Enemy units **and** structures destroyed.
    *   `units alive`: Remaining units at game end.
    *   `structures alive`: Remaining structures at game end.
    *   `army value`: Total value of remaining army.
*   **Timeline**: Mean credits and army value per minute for each faction in mixed matchups.

## JSON Layout
The simulation outputs a JSON file with the following top-level keys:
*   `cells`: Array of `MatrixCell` objects. Each contains `factionA`, `factionB`, `difficulty`, and an array of `results`.
*   `poolRuns`: Array of `GameResult` objects, one per 2-player `MAP_POOL` entry at normal/normal.
*   `results`: (Implicitly within `cells` and `poolRuns`) Each `GameResult` contains:
    *   `config`: Matchup details (factions, difficulties, seed, map).
    *   `winnerFaction`: `"alliance"`, `"pact"`, or `"draw"`.
    *   `winnerTeam`: `0`, `1`, or `-1` (draw).
    *   `durationGameMinutes`: Game length.
    *   `players`: Array of `PlayerEndStats` (credits, harvested, built, lost, kills, unitsAlive, structuresAlive, armyValue).
    *   `timeline`: Array of `TimelineSample` objects (gameSeconds, player credits/armyValue).
*   `totals`: Aggregate stats (games, wins, draws, avg duration).

## Anomaly Detectors
The analyzer flags three types of anomalies:
1.  **Economy Stall**: If either player's `harvested` is below 3000.
2.  **No Contact**: If both players have 0 kills and the game lasted 8+ minutes.
3.  **Unfinished Kill**: If the game is a draw (`winnerTeam === -1`), one side has 0 units and ≤3 structures, while the other has ≥8 units.

## Adding a New Metric
1.  **Define**: Add the field to `PlayerEndStats` in `scripts/simulate.ts`.
2.  **Populate**: Compute it in `scripts/simulate.ts` from `SimState` at game end (or per sample for the timeline). Only add a field to `Player.stats` in `src/sim` if the sim itself must track it.
3.  **Analyze**: Update `scripts/analyze.mjs` to:
    *   Extract the new field from `g.players`.
    *   Add it to the aggregation logic (e.g., in the `side` map).
    *   Print the new column in the "Per side means" table.

## Baseline vs fixed comparison
Run the harness before and after a balance or AI change and diff the two `analyze.mjs` outputs. Games are deterministic per seed, so any difference is caused by the change, not by noise.

## Campaign playthrough

`npm run sim:campaign [-- --only a01,p03] [--minutes 45] [--difficulty hard]` plays every
mission headlessly with the skirmish AI standing in for the human and reports win / lose /
timeout per mission with the final objective statuses (`scripts/out/campaign-run.json`).
The stand-in is goal-directed for `buildType` objectives, captures with engineers, sends spies,
and hunts with strike forces, but it cannot micro-manage, so a loss here means "hard for an
AI", not "impossible"; a timeout usually means an objective the stand-in cannot pursue.
