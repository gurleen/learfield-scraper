import { describe, expect, test } from "bun:test";
import { fetchSidearm } from "./fetch";

function startServer(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: handler,
  });
  return {
    url: `http://${server.hostname}:${server.port}`,
    stop: () => server.stop(true),
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
      const res = await fetchSidearm(url + "/", { htmlProxy: false });
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
        htmlProxy: false,
      });
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  test("throws after a same-URL redirect loop when the HTML proxy is disabled", async () => {
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
        fetchSidearm(url + "/", { htmlProxy: false, maxRedirects: 8 }),
      ).rejects.toThrow(/Too many redirects/);
    } finally {
      stop();
    }
  });

  test("falls back to the HTML proxy after a same-URL 301 loop", async () => {
    const blocked = startServer((req) => {
      const loc = new URL(req.url).href;
      return new Response(null, {
        status: 301,
        headers: {
          Location: loc,
          "Set-Cookie": "visid_incap=ok; path=/",
        },
      });
    });
    const proxy = startServer(
      () =>
        new Response("<html><a href='/sports/womens-soccer'>WSOC</a></html>", {
          status: 200,
        }),
    );

    try {
      const res = await fetchSidearm(blocked.url + "/", {
        htmlProxy: proxy.url + "/",
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("womens-soccer");
    } finally {
      blocked.stop();
      proxy.stop();
    }
  });
});
