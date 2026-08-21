import { describe, expect, test } from "bun:test";
import { scrapeClassic } from "./adapters/classic";
import { fetchSidearm, type FetchSidearmEnv } from "./fetch";
import {
  htmlCacheKey,
  htmlCacheTtlSeconds,
  HTML_CACHE_HOMEPAGE_TTL_SECONDS,
  HTML_CACHE_ROSTER_TTL_SECONDS,
  type HtmlCacheStore,
} from "./html-cache";
import { publicModelKey } from "./models";

function startServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: handler,
    hostname: "127.0.0.1",
  });
  return {
    url: `http://${server.hostname}:${server.port}`,
    stop: () => server.stop(true),
  };
}

function sameUrlRedirect(req: Request): Response {
  return new Response(null, {
    status: 301,
    headers: {
      Location: new URL(req.url).href,
      "Set-Cookie": "visid_incap=ok; path=/",
    },
  });
}

function memoryR2(): {
  store: Map<string, { body: string; customMetadata: Record<string, string> }>;
  models: HtmlCacheStore;
} {
  const store = new Map<
    string,
    { body: string; customMetadata: Record<string, string> }
  >();
  return {
    store,
    models: {
      async get(key: string) {
        const obj = store.get(key);
        if (!obj) return null;
        return {
          text: async () => obj.body,
          customMetadata: obj.customMetadata,
        };
      },
      async put(key, value, options) {
        store.set(key, {
          body: value,
          customMetadata: options?.customMetadata ?? {},
        });
      },
    },
  };
}

function mockBrowser(
  html: string,
  calls: string[] = [],
): NonNullable<FetchSidearmEnv["BROWSER"]> {
  return {
    async quickAction(_action, options) {
      calls.push(options.url);
      return Response.json({ success: true, result: html });
    },
  };
}

describe("fetchSidearm", () => {
  test("replays Set-Cookie on same-URL Imperva-style 302 loops", async () => {
    const { url, stop } = startServer((req) => {
      const cookies = req.headers.get("cookie") ?? "";
      if (!cookies.includes("visid_incap=ok")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: url + "/",
            "Set-Cookie": "visid_incap=ok; path=/",
          },
        });
      }
      return new Response("ok-body", { status: 200 });
    });

    try {
      const res = await fetchSidearm(url + "/", { htmlFallback: false });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok-body");
    } finally {
      stop();
    }
  });

  test("returns non-redirect responses as-is", async () => {
    const { url, stop } = startServer(
      () => new Response("missing", { status: 404 }),
    );
    try {
      const res = await fetchSidearm(`${url}/api/v2/Sports`, {
        htmlFallback: false,
      });
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  test("throws after a same-URL redirect loop when HTML fallback is disabled", async () => {
    const { url, stop } = startServer(
      () =>
        new Response(null, {
          status: 301,
          headers: {
            Location: url + "/",
            "Set-Cookie": "visid_incap=ok; path=/",
          },
        }),
    );
    try {
      await expect(
        fetchSidearm(url + "/", { htmlFallback: false, maxRedirects: 8 }),
      ).rejects.toThrow(/Too many redirects/);
    } finally {
      stop();
    }
  });

  test("renders with Browser Run and writes R2 on cache miss", async () => {
    const blocked = startServer(sameUrlRedirect);
    const { store, models } = memoryR2();
    const browserCalls: string[] = [];
    const html = "<html><a href='/sports/womens-soccer'>WSOC</a></html>";

    try {
      const target = blocked.url + "/";
      const res = await fetchSidearm(target, {
        env: { MODELS: models, BROWSER: mockBrowser(html, browserCalls) },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("womens-soccer");
      expect(browserCalls).toEqual([target]);

      const key = await htmlCacheKey(target);
      const cached = store.get(key);
      expect(cached?.body).toContain("womens-soccer");
      expect(cached?.customMetadata["source-url"]).toBe(target);
      expect(cached?.customMetadata["ttl-seconds"]).toBe(
        String(HTML_CACHE_HOMEPAGE_TTL_SECONDS),
      );
      expect(cached?.customMetadata["fetched-at"]).toBeTruthy();
    } finally {
      blocked.stop();
    }
  });

  test("returns fresh R2 HTML without calling Browser Run", async () => {
    const blocked = startServer(sameUrlRedirect);
    const { models } = memoryR2();
    const browserCalls: string[] = [];
    const target = blocked.url + "/";
    const cachedHtml = "<html>from-r2</html>";

    await models.put(await htmlCacheKey(target), cachedHtml, {
      customMetadata: {
        "source-url": target,
        "fetched-at": new Date().toISOString(),
        "ttl-seconds": String(HTML_CACHE_HOMEPAGE_TTL_SECONDS),
      },
    });

    try {
      const res = await fetchSidearm(target, {
        env: {
          MODELS: models,
          BROWSER: mockBrowser("<html>browser</html>", browserCalls),
        },
      });
      expect(await res.text()).toBe(cachedHtml);
      expect(browserCalls).toEqual([]);
    } finally {
      blocked.stop();
    }
  });

  test("ignores stale R2 HTML and re-renders", async () => {
    const blocked = startServer(sameUrlRedirect);
    const { models } = memoryR2();
    const browserCalls: string[] = [];
    const target = blocked.url + "/sports/womens-soccer/roster";
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

    await models.put(await htmlCacheKey(target), "<html>stale</html>", {
      customMetadata: {
        "source-url": target,
        "fetched-at": stale,
        "ttl-seconds": String(HTML_CACHE_ROSTER_TTL_SECONDS),
      },
    });

    try {
      const res = await fetchSidearm(target, {
        env: {
          MODELS: models,
          BROWSER: mockBrowser("<html>fresh</html>", browserCalls),
        },
      });
      expect(await res.text()).toBe("<html>fresh</html>");
      expect(browserCalls).toEqual([target]);
    } finally {
      blocked.stop();
    }
  });

  test("does not use Browser Run for JSON API requests", async () => {
    const blocked = startServer(sameUrlRedirect);
    const browserCalls: string[] = [];

    try {
      await expect(
        fetchSidearm(`${blocked.url}/api/v2/Sports`, {
          headers: { Accept: "application/json" },
          env: { BROWSER: mockBrowser("<html>nope</html>", browserCalls) },
        }),
      ).rejects.toThrow(/Too many redirects/);
      expect(browserCalls).toEqual([]);
    } finally {
      blocked.stop();
    }
  });

  test("throws a clear error when Browser Rendering is not configured", async () => {
    const blocked = startServer(sameUrlRedirect);
    try {
      await expect(fetchSidearm(blocked.url + "/")).rejects.toThrow(
        /Browser Rendering is not configured/,
      );
    } finally {
      blocked.stop();
    }
  });
});

describe("html cache keys", () => {
  test("uses 24h TTL for homepages and 6h for roster pages", () => {
    expect(htmlCacheTtlSeconds("https://nuhuskies.com/")).toBe(
      HTML_CACHE_HOMEPAGE_TTL_SECONDS,
    );
    expect(
      htmlCacheTtlSeconds(
        "https://nuhuskies.com/sports/womens-soccer/roster",
      ),
    ).toBe(HTML_CACHE_ROSTER_TTL_SECONDS);
  });

  test("keys are namespaced under html-cache/{host}/", async () => {
    const key = await htmlCacheKey("https://nuhuskies.com/");
    expect(key.startsWith("html-cache/nuhuskies.com/")).toBe(true);
    expect(key.endsWith(".html")).toBe(true);
  });
});

describe("publicModelKey", () => {
  test("allows public model objects", () => {
    expect(publicModelKey("/models/rmbg-1.4.onnx")).toBe("rmbg-1.4.onnx");
  });

  test("rejects html-cache keys so cached HTML cannot leak", () => {
    expect(publicModelKey("/models/html-cache/nuhuskies.com/abc.html")).toBe(
      null,
    );
    expect(publicModelKey("/models/html-cache")).toBe(null);
    expect(publicModelKey("/models/html-cache/")).toBe(null);
  });

  test("rejects traversal and missing keys", () => {
    expect(publicModelKey("/models/../secret")).toBe(null);
    expect(publicModelKey("/models")).toBe(null);
    expect(publicModelKey("/api/scrape")).toBe(null);
  });
});

describe("scrapeClassic", () => {
  test("parses already-fetched HTML without a second request", () => {
    const html = `
      <h1>Women's Soccer</h1>
      <ul>
        <li class="sidearm-roster-player">
          <span class="sidearm-roster-player-jersey-number">10</span>
          <div class="sidearm-roster-player-name"><a href="/bios/1">Ada Lovelace</a></div>
        </li>
      </ul>
    `;
    const roster = scrapeClassic(
      "https://athletics.holyfamily.edu/sports/womens-soccer/roster",
      html,
    );
    expect(roster.platform).toBe("classic");
    expect(roster.players).toHaveLength(1);
    expect(roster.players[0]?.firstName).toBe("Ada");
    expect(roster.players[0]?.jerseyNumber).toBe("10");
  });
});
