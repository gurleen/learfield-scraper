import { join } from "node:path";
import { scrapeRoster } from "./src/scrape";
import { listSports } from "./src/sports";
import type { RosterResult } from "./src/types";
import { zipPlayerHeadshots, parseImageNaming } from "./src/zip-images";

const root = import.meta.dir;
const distDir = join(root, "dist");

function apiResponse(req: Request): Promise<Response> | Response | null {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/api/sports" && req.method === "GET") {
    return (async () => {
      try {
        const website = url.searchParams.get("website")?.trim();
        if (!website) {
          return Response.json({ error: "Missing website" }, { status: 400 });
        }
        const sports = await listSports(website);
        return Response.json({ sports });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sports lookup failed";
        return Response.json({ error: message }, { status: 422 });
      }
    })();
  }

  if (pathname === "/api/scrape" && req.method === "POST") {
    return (async () => {
      try {
        const body = (await req.json()) as { url?: string };
        if (!body.url?.trim()) {
          return Response.json({ error: "Missing url" }, { status: 400 });
        }
        const result = await scrapeRoster(body.url);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scrape failed";
        return Response.json({ error: message }, { status: 422 });
      }
    })();
  }

  if (pathname === "/api/zip-headshots" && req.method === "POST") {
    return (async () => {
      try {
        const body = (await req.json()) as {
          roster?: RosterResult;
          naming?: string;
        };
        if (!body.roster?.players?.length) {
          return Response.json({ error: "Missing roster" }, { status: 400 });
        }
        const naming = parseImageNaming(body.naming);
        const { zip, count, skipped } = await zipPlayerHeadshots(
          body.roster,
          naming,
        );
        const filename = `${body.roster.schoolHost}-${body.roster.sportSlug}-headshots.zip`;
        return new Response(zip, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "X-Headshot-Count": String(count),
            "X-Headshot-Skipped": String(skipped),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Zip failed";
        return Response.json({ error: message }, { status: 422 });
      }
    })();
  }

  return null;
}

async function staticFromDist(pathname: string): Promise<Response | null> {
  const filePath =
    pathname === "/" || pathname === ""
      ? join(distDir, "index.html")
      : join(distDir, pathname.slice(1));
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  if (!pathname.includes(".")) {
    const fallback = Bun.file(join(distDir, "index.html"));
    if (await fallback.exists()) {
      return new Response(fallback);
    }
  }
  return null;
}

export function startServer(options?: { serveStatic?: boolean }): void {
  const port = Number(process.env.PORT) || 3001;
  const serveStatic = options?.serveStatic ?? process.env.SERVE_STATIC === "1";

  Bun.serve({
    port,
    async fetch(req) {
      const api = apiResponse(req);
      if (api) return api;

      if (serveStatic) {
        const { pathname } = new URL(req.url);
        const staticRes = await staticFromDist(pathname);
        if (staticRes) return staticRes;
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(
    serveStatic
      ? `Roster scraper (API + static) at http://localhost:${port}`
      : `Roster API at http://localhost:${port}`,
  );
}

if (import.meta.path === Bun.main) {
  startServer({
    serveStatic: process.env.SERVE_STATIC !== "0",
  });
}
