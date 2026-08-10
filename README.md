# Sidearm Roster Scraper

Bun + TypeScript app that scrapes **Sidearm Sports** roster pages (NextGen JSON API or Classic HTML), normalizes player and coach data with original headshot URLs, and exposes a small web UI built with [`@gurleen-ui`](https://github.com/gurleen/ui).

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

`@gurleen-ui/core` and `@gurleen-ui/tokens` are linked from `../ui/packages/*`. React / React DOM are the **same copies** as the UI monorepo (`file:../ui/node_modules/react`) so Vite does not resolve two Reacts (which breaks hooks).

```sh
cd ../ui && npm install && npm run build   # once, if needed
cd ../learfield-scraper && bun install && bun run dev
```
