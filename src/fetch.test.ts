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
      const res = await fetchSidearm(url + "/");
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
      const res = await fetchSidearm(`${url}/api/v2/Sports`);
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  test("throws after too many redirects when the cookie never satisfies", async () => {
    const { url, stop } = startServer(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: url + "/" },
        }),
    );
    try {
      await expect(fetchSidearm(url + "/", { maxRedirects: 3 })).rejects.toThrow(
        /Too many redirects/,
      );
    } finally {
      stop();
    }
  });
});
