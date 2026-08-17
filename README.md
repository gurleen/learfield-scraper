# Sidearm Roster Scraper

Bun + TypeScript app that scrapes **Sidearm Sports** roster pages (NextGen JSON API or Classic HTML), normalizes player and coach data with original headshot URLs, and exposes a small web UI built with [`@hydra-tv/ui`](https://www.npmjs.com/package/@hydra-tv/ui).

## Quick start

```sh
bun install
bun run dev
```

Open http://localhost:3000, paste a roster URL (e.g. `https://drexeldragons.com/sports/womens-soccer/roster`), and click **Scrape**.

`bun run dev` runs **Vite** on port 3000 (UI + HMR) and the Bun API on port 3001 (`/api` is proxied).

```sh
bun run build   # vite build → dist/
bun run start   # Bun serves API + dist on http://localhost:3000
```

## Supported URLs

Any Sidearm roster URL of the form:

`https://{host}/sports/{sport-slug}/roster`

- **NextGen** sites (e.g. Drexel): uses `/api/v2/Sports` and `/api/v2/Rosters`
- **Classic** sites (e.g. Holy Family): parses `.sidearm-roster-player` / `.sidearm-roster-coach` HTML

Headshot URLs are resolved to originals when served through `images.sidearmdev.com` or query-string resize params.

## API

- `POST /api/scrape` — `{ "url": "..." }` → `RosterResult`
- `POST /api/zip-headshots` — `{ "roster": RosterResult, "naming": "named" | "numbered" }` → zip file

## UI dependency

The UI is [`@hydra-tv/ui`](https://www.npmjs.com/package/@hydra-tv/ui) with tokens from [`@hydra-tv/tokens`](https://www.npmjs.com/package/@hydra-tv/tokens), both installed from npm. Vite `dedupe`s `react` / `react-dom` so the app and the library share one React (duplicate copies break hooks).
