import { describe, expect, test } from "bun:test";
import {
  collectClassicSports,
  isAthleticsSplashUrl,
  listClassicSports,
} from "./sports";

function startServer(
  handler: (req: Request) => Response | Promise<Response>,
): { origin: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: handler,
  });
  return {
    origin: `http://${server.hostname}:${server.port}`,
    stop: () => server.stop(true),
  };
}

describe("isAthleticsSplashUrl", () => {
  test("detects Sidearm splash interstitials", () => {
    expect(
      isAthleticsSplashUrl("https://wagnerathletics.com/splash.aspx?id=splash_351"),
    ).toBe(true);
    expect(isAthleticsSplashUrl("https://wagnerathletics.com/")).toBe(false);
    expect(
      isAthleticsSplashUrl(
        "https://wagnerathletics.com/sports/womens-soccer/roster",
      ),
    ).toBe(false);
  });
});

describe("collectClassicSports", () => {
  test("returns no sports from a ticket splash page", () => {
    const html = `
      <html><title>26 FB Single Game Tickets</title>
      <body><a href="/splash.aspx?id=splash_351">Tickets</a></body></html>
    `;
    expect(
      collectClassicSports(html, "https://wagnerathletics.com"),
    ).toEqual([]);
  });

  test("collects index and roster nav links", () => {
    const html = `
      <nav>
        <a href="/sports/baseball">Baseball</a>
        <a href="/sports/football/roster">Football</a>
        <a href="/sports/womens-soccer/roster">WSOC</a>
        <a href="/sports/2015/8/18/SASS.aspx">SASS</a>
        <a href="/admissions">Ignore</a>
      </nav>
    `;
    expect(
      collectClassicSports(html, "https://wagnerathletics.com").map((s) => s.slug),
    ).toEqual(["baseball", "football", "womens-soccer"]);
  });
});

describe("listClassicSports", () => {
  test("skips homepage splash and reads sports from the roster nav", async () => {
    const { origin, stop } = startServer((req) => {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        return new Response(null, {
          status: 302,
          headers: { Location: "/splash.aspx?id=splash_351" },
        });
      }
      if (pathname === "/splash.aspx") {
        return new Response(
          `<html><title>Tickets</title><a href="/tickets">Buy</a></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (pathname === "/sports/womens-soccer/roster") {
        return new Response(
          `<nav>
            <a href="/sports/baseball">Baseball</a>
            <a href="/sports/football">Football</a>
            <a href="/sports/womens-soccer">Women's Soccer</a>
           </nav>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (pathname === "/api/v2/Sports") {
        return new Response("not found", { status: 404 });
      }
      return new Response("missing", { status: 404 });
    });

    try {
      const sports = await listClassicSports(origin);
      expect(sports.map((s) => s.slug)).toEqual([
        "baseball",
        "football",
        "womens-soccer",
      ]);
    } finally {
      stop();
    }
  });
});
