import { scrapeRoster } from "./scrape";
import { listSports } from "./sports";
import type { FetchSidearmEnv } from "./fetch";
import type { RosterResult } from "./types";
import { zipPlayerHeadshots, parseImageNaming } from "./zip-images";

/** Handle `/api/*` routes. Returns null if the path is not an API route. */
export function handleApi(
  req: Request,
  env?: FetchSidearmEnv,
): Promise<Response> | Response | null {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/api/sports" && req.method === "GET") {
    return (async () => {
      try {
        const website = url.searchParams.get("website")?.trim();
        if (!website) {
          return Response.json({ error: "Missing website" }, { status: 400 });
        }
        const sports = await listSports(website, env);
        return Response.json({ sports });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Sports lookup failed";
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
        const result = await scrapeRoster(body.url, env);
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
