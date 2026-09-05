# Deployment path — how this game reaches speedrungames.net

Researched 2026-09-05 against the live checkouts and repos on this machine. Every claim
below was read from current source, not from memory. Re-verify anything dated before
relying on it; the files named here are the authorities.

## 1. The estate, in one picture

```
Brynrg/iron-meridian  (this repo; local: ~/Code/games/iron-meridian)
   │  push to main
   ▼
.github/workflows/deploy.yml  (12-line caller; reads slug from game.manifest.json)
   │  uses: Brynrg/speedrungames/.github/workflows/deploy-game.yml@main
   ▼
Reusable deploy workflow (runs in the GAME repo's Actions, with SPEEDRUNGAMES_TOKEN)
   1. npm ci  →  npm run build  →  requires dist/index.html
   2. checks out Brynrg/speedrungames@main
   3. node scripts/ingest-game-build.mjs --game-dir ../game --status live
   4. branch game/<slug>-<sha>-<runId>, commit "deploy(<slug>): sync from <repo>@<sha>"
   5. gh pr create + gh pr merge --auto --squash
   ▼
Brynrg/speedrungames  (portal; local: ~/Code/games/speedrungames)
   • apps/web/public/games/iron-meridian/{index.html,assets/,manifest.json}
   • apps/web/src/lib/games.registry.json  (GENERATED — never hand-edit)
   │  PR auto-merges only when portal CI + Netlify deploy preview pass
   ▼
Netlify site 71683967-2b9c-4227-8fec-0ae0d41ef0d9  →  https://speedrungames.net/games/iron-meridian/
   build: pnpm install --frozen-lockfile && pnpm -C apps/web build   (Node 22, pnpm 10.30.0)
   publish: apps/web/.next via @netlify/plugin-nextjs
   prebuild: registry build + manifest VALIDATOR — one invalid manifest reds the whole site build
```

Sources: portal `AGENTS.md` §0–§9, `netlify.toml`, `.github/workflows/deploy-game.yml`,
`scripts/new-game.mjs`, `scripts/ingest-game-build.mjs`, `docs/browser-game-template-contract.md`;
template `.github/workflows/{ci,deploy}.yml`, `AGENTS.md`.

## 2. Where this folder sits in the organization

`~/Code/README.md` files every repo under one parent: `active/`, `games/`, `experiments/`,
`_vendor/`, `archived/`. Game repos live flat under `~/Code/games/<slug>/`, one clone per
repo, kebab-case. The portal's own `pnpm new:game --dry-run` resolved the clone target for
this slug to exactly `~/Code/games/iron-meridian` (it clones alongside the portal checkout),
so this folder is where the tooling itself would have put it.

Sibling precedents used as reference:

| Repo | Role | Notes |
|---|---|---|
| `speedrungames/` | portal + canonical tooling | `AGENTS.md` is the contract |
| `speedrungames-game-template/` | scaffold this repo was copied from | Vite + TS + Playwright smoke + SDK |
| `shard-dominion/` | closest precedent: Westwood-style web RTS, `vite-canvas2d`, sim/view split | 13.7k LOC TS, 20 Hz lockstep sim |
| `tank-you-again/` | reference for a game with its own backend (`DEPLOYMENT.md`, `VITE_WS_URL`) | Fly backend |

Per-project convention (also from `~/Code/README.md` rule 6): a `retired/` folder stages
superseded code with a dated subfolder and a ledger line; nothing is deleted in place.

## 3. Creating the GitHub repo (done 2026-09-05 on the owner's authorization; kept for reference)

The canonical creator is `pnpm new:game` in the portal. It was run in `--dry-run` mode only.
Its plan (verified output):

```
repo:      Brynrg/iron-meridian (public)
template:  Brynrg/speedrungames-game-template
clone to:  /Users/jonathangarnett/Code/games/iron-meridian
secret:    SPEEDRUNGAMES_TOKEN (from macOS Keychain) -> set on new repo
live URL:  https://speedrungames.net/games/iron-meridian/
```

**Do not run the real `pnpm new:game --slug iron-meridian` now.** It `rmSync`s the clone
target when it already exists, which would delete this folder. Because this folder already
holds the substituted template, the equivalent steps are done by hand:

```bash
cd ~/Code/games/iron-meridian
git add -A && git commit -m "chore: scaffold iron-meridian from speedrungames-game-template"
gh repo create Brynrg/iron-meridian --public --source . --remote origin --push \
  --description "Cold-war alternate-history RTS in the classic Westwood mould"
security find-generic-password -s SPEEDRUNGAMES_TOKEN -w | gh secret set SPEEDRUNGAMES_TOKEN -R Brynrg/iron-meridian
```

The secret value never appears on screen in that pipeline. Preconditions verified on
2026-09-05: `gh` is logged in as `Brynrg` with `repo` + `workflow` scopes, and the Keychain
item `SPEEDRUNGAMES_TOKEN` is present (presence only was checked; the value was not read).
Public repos keep Actions free (the script's default).

The first push to `main` runs `deploy.yml`, which opens the first auto-merging portal PR.
Every later push to `main` auto-deploys. Deploys are gated: nothing reaches the live site
unless game CI, the portal's checks, and the Netlify deploy preview all pass.

## 4. What the build must satisfy (the contract)

From `docs/browser-game-template-contract.md` and the portal `AGENTS.md`:

- `npm run build` produces `dist/index.html` + assets. `npm test` is the Playwright smoke
  (game-root element within 3 s, zero console errors). `npm run typecheck`, `npm run lint:paths`
  must pass (game CI runs all four).
- `vite.config.ts` keeps `base: "./"`. **No root-absolute asset URLs** anywhere in HTML/CSS/JS.
- `game.manifest.json` drives everything: `slug` (kebab, ≤48 chars in schema, ≤24 in the
  creator script), `title`, `description`, `framework` (schema enum includes `vite-canvas2d`),
  `category`, `supportsMobile`, `version`, `emoji`, `repo`. Bump `version` per release; the
  ingest copies it into the portal manifest.
- Optional but recommended once the game ships sprite atlases: `expectedAssets`
  (`[{ dir, ext, min }]`) so a build with an empty asset directory fails at ingest, not in
  players' browsers (the Pokémon 0-of-151-sprites incident is why this exists).
- Runs inside `<iframe sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-gamepad" allow="gamepad; fullscreen">`.
  No `window.parent`/`window.top`, no navigation upward.
- `localStorage` keys prefixed `speedrungames:<slug>:` — use `createStorage(slug)` from
  `speedrungames-sdk` rather than raw keys (saves, settings, PBs).
- Fully static. No backend, external API, analytics, auth, or CDN without a vendored fallback.
- Every non-code asset must be original or licensed, listed in `ASSETS.md` (fonts, audio,
  sprites). This matters for a Westwood-parity game: **no ripped C&C assets, names, or audio.**
- Multiplayer is opt-in and must declare `multiplayer` + `multiplayerProvider` in the manifest,
  using an approved free-tier pattern (`p2p`/`webrtc`, `realtime-server`/`partykit` or
  `cloudflare-do`, `async`/`netlify-blobs`). No always-on paid servers. See portal
  `docs/multiplayer-architecture.md` before designing lockstep netplay.

## 5. Manual fallback (only when CI cannot run)

`npm run deploy:portal` builds, finds the sibling `../speedrungames` checkout, and runs the
portal's canonical ingest — it does **not** copy files. The result is a portal working-tree
change to commit on a branch and open as a PR. Direct pushes to portal `main` and hand-copying
into `apps/web/public/games/` are forbidden by portal `AGENTS.md` §9.

## 6. Verifying a deploy actually landed

1. Game repo → Actions → the deploy run prints `Opened: <portal PR URL>`.
2. Portal PR auto-merges when checks pass (or stays open with a warning if auto-merge is not
   configured — then the PR link is the thing to inspect).
3. Netlify: verify by **deploy state, not URL polling**:

```bash
netlify api listSiteDeploys --data '{"site_id":"71683967-2b9c-4227-8fec-0ae0d41ef0d9","per_page":2}'
```

Wait for `state: ready` on your `commit_ref` (parse with `json.loads(..., strict=False)`;
deploy titles embed raw newlines). `state: error` carries `error_message`. A stale-but-200
URL is indistinguishable from a broken build; that is how a 15-hour red deploy once went
unnoticed on `shard-dominion`.

## 7. Contradictions found (report, do not silently resolve)

- `shard-dominion/HANDOFF.md` §"Deploy pipeline" documents **hand-copying `dist/` into the
  portal and pushing straight to portal `main`**, and its manifest declares
  `repo: Brynrg/speedrungames`. The portal git log confirms this is how `shard-dominion` is
  currently shipped (`deploy(shard-dominion): v0.62.0 …` commits on `main`). Portal
  `AGENTS.md` §0 and §9 forbid exactly that. **This repo uses the canonical route only.**
- `scripts/new-game.mjs` accepts `--framework` values that exclude `vite-canvas2d`, while both
  manifest schemas include it and `shard-dominion` is live with it. This repo sets
  `vite-canvas2d` directly in the manifest (the creator script is not used).
- `speedrungames/README.md` "Currently live" table lists 4 games; the generated registry lists
  12 (11 live + 1 archived). Treat the registry, not the README, as the catalog authority.

## 8. Authority boundaries for this repo

Following `~/.claude/CLAUDE.md`: implementation, tests, repo creation, Git commit/push,
secret setting, and live acceptance are separate authorities. State as of this document:

| Step | State |
|---|---|
| Folder created at `~/Code/games/iron-meridian`, `git init` | Done |
| Local typecheck / build / lints / vitest / Playwright | Pass (2026-09-05) |
| GitHub repo `Brynrg/iron-meridian` | Created 2026-09-05 (public), `main` pushed |
| `SPEEDRUNGAMES_TOKEN` secret on the repo | Set from Keychain via `gh secret set` (value never shown) |
| First deploy | Pass: game run 33992837957 → portal PR #166 auto-merged (`c33e9fc`) → Netlify production `ready` |
| Live URL | Pass: https://speedrungames.net/games/iron-meridian/ serves v1.0.0, listed on the homepage |
