# AGENTS.md

Orientation for coding agents working in this repo.

## What this app does

**learfield-scraper** scrapes college athletics **roster pages** built on **Sidearm Sports** (Learfield) and turns them into structured player/coach data plus original headshot URLs.

Users paste a roster URL into a small web UI, scrape on demand (no database), then:

- Browse players and coaches in a table
- Copy/download the roster as **JSON** (full result) or **CSV** (players only)
- Download all player headshots as a **ZIP**, with filename scheme `jersey_lastname_firstname.ext` or sequential `1.jpg`, `2.jpg`, …

Sport-agnostic: any URL shaped like `https://{host}/sports/{sport-slug}/roster` works for supported Sidearm hosts (women’s soccer today; other sports later via the same path).

Example sites:

- NextGen: `https://drexeldragons.com/sports/womens-soccer/roster`
- Classic: `https://athletics.holyfamily.edu/sports/womens-soccer/roster`

## Architecture

```
frontend.tsx  →  Vite (dev :3000)  →  proxies /api → Bun API (:3001)
index.ts      →  Bun.serve: scrape + zip-headshots (+ optional static dist)
src/scrape.ts →  detect platform → adapters/nextgen | adapters/classic
```

- **NextGen** (Nuxt Sidearm): `GET /api/v2/Sports` then `GET /api/v2/Rosters?sportId=`
- **Classic**: cheerio on `.sidearm-roster-player` / `.sidearm-roster-coach`
- Headshots: unwrap `images.sidearmdev.com/…?url=` and strip resize query params (`src/images.ts`)

Shared shape: `RosterResult` / `Player` / `Coach` in `src/types.ts`. Missing fields stay `null`.

## Layout

| Path | Role |
|------|------|
| `frontend.tsx` | React UI (`@hydra-tv/ui`) |
| `index.html` | Vite entry |
| `index.ts` | Bun API (+ production static from `dist/`) |
| `scripts/dev.ts` | Spawns Bun API + Vite |
| `vite.config.ts` | Vite, React dedupe, `/api` proxy |
| `src/scrape.ts` | Orchestrator + platform detect |
| `src/adapters/nextgen.ts` | JSON API adapter |
| `src/adapters/classic.ts` | HTML adapter |
| `src/images.ts` | Original image URL resolution |
| `src/export.ts` | JSON/CSV serialization |
| `src/zip-images.ts` | Fetch headshots → ZIP (`fflate`) |

## Commands

```sh
bun install
bun run dev      # Vite :3000 + API :3001
bun run build    # vite build → dist/
bun run start    # API + dist on :3000
```

Use **Bun**, not Node/npm, for app scripts.

## UI stack rules

- Components from `@hydra-tv/ui` + tokens from `@hydra-tv/tokens` (published on npm).
- **One React only.** Vite `dedupe`s `react` / `react-dom`. Do not add a second React; duplicate React breaks hooks (`useState` null).
- Prefer `@hydra-tv/ui` (`Button`, `Input`, `Select`, `DataGrid`, `Panel`, …) over ad-hoc controls.

## When changing scrapers

1. Keep adapters behind `scrapeRoster()` and the same `RosterResult` types.
2. Do not hardcode school or sport names; parse `/sports/{slug}/roster`.
3. Always run headshot URLs through `resolveOriginalImageUrl`.
4. Verify against both a NextGen and a Classic sample URL when possible.

## API

- `POST /api/scrape` — `{ url }` → `RosterResult`
- `POST /api/zip-headshots` — `{ roster, naming: "named" | "numbered" }` → `application/zip`
- `GET /api/sports?website=` — `{ sports: { slug, title }[] }`

## Deploy (Cloudflare Workers)

```sh
bun run deploy   # vite build + wrangler deploy
```

Live at **https://rosters.dragonstv.io** (`wrangler.jsonc` custom domain).
