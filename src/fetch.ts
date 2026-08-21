import {
  readCachedHtml,
  writeCachedHtml,
  type HtmlCacheStore,
} from "./html-cache";

/** Shared User-Agent for Sidearm / athletics site requests. */
export const SIDEARM_USER_AGENT =
  "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)";

const MAX_REDIRECTS = 20;
const SAME_URL_REDIRECT_LIMIT = 2;
const BROWSER_GOTO_TIMEOUT_MS = 25_000;

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
};

export type BrowserContentBinding = {
  quickAction(
    action: "content",
    options: {
      url: string;
      gotoOptions?: { waitUntil?: string; timeout?: number };
    },
  ): Promise<Response>;
};

export type FetchSidearmEnv = {
  MODELS?: HtmlCacheStore;
  BROWSER?: BrowserContentBinding;
};

export type FetchSidearmInit = RequestInit & {
  maxRedirects?: number;
  env?: FetchSidearmEnv;
  /** When false, do not use R2/browser after a same-URL 301 loop. */
  htmlFallback?: boolean;
};

type DirectInit = RequestInit & { maxRedirects?: number };

function setCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function parseSetCookie(header: string, requestUrl: URL): StoredCookie | null {
  const parts = header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const nv = parts[0];
  if (!nv) return null;
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;

  let domain = requestUrl.hostname.toLowerCase();
  let hostOnly = true;
  for (const attr of parts.slice(1)) {
    const sep = attr.indexOf("=");
    const key = (sep === -1 ? attr : attr.slice(0, sep)).trim().toLowerCase();
    const val = sep === -1 ? "" : attr.slice(sep + 1).trim();
    if (key === "domain" && val) {
      domain = val.replace(/^\./, "").toLowerCase();
      hostOnly = false;
    }
  }
  return { name, value, domain, hostOnly };
}

function cookieMatches(cookie: StoredCookie, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (cookie.hostOnly) return host === cookie.domain;
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function isRedirectLoopError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /too many redirects/i.test(message);
}

function wantsJson(headers: HeadersInit | undefined): boolean {
  return new Headers(headers).get("Accept")?.includes("application/json") ?? false;
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function renderWithBrowser(
  browser: BrowserContentBinding,
  url: string,
): Promise<string> {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: {
      waitUntil: "networkidle2",
      timeout: BROWSER_GOTO_TIMEOUT_MS,
    },
  });
  const payload = (await response.json()) as {
    success?: boolean;
    result?: string;
    errors?: { message?: string }[];
  };
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.[0]?.message;
    throw new Error(
      `Browser Rendering failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  if (typeof payload.result !== "string" || !payload.result) {
    throw new Error("Browser Rendering returned no HTML");
  }
  return payload.result;
}

async function fetchViaBrowserOrCache(
  url: string,
  env: FetchSidearmEnv | undefined,
  blockedReason: string,
): Promise<Response> {
  const cached = await readCachedHtml(env?.MODELS, url);
  if (cached != null) {
    return htmlResponse(cached);
  }

  if (!env?.BROWSER) {
    throw new Error(
      `Athletics site blocked Worker fetch; Browser Rendering is not configured (${blockedReason})`,
    );
  }

  const html = await renderWithBrowser(env.BROWSER, url);
  try {
    await writeCachedHtml(env.MODELS, url, html);
  } catch {
    /* cache write is best-effort */
  }
  return htmlResponse(html);
}

async function fetchDirectWithCookies(
  url: string,
  init: DirectInit,
): Promise<{ res: Response } | { blocked: true; hops: string[] }> {
  const { maxRedirects = MAX_REDIRECTS, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", SIDEARM_USER_AGENT);
  }

  const jar: StoredCookie[] = [];
  let current = url;
  const hops: string[] = [];
  let sameUrlRedirects = 0;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    hops.push(current);
    const target = new URL(current);
    const matching = jar.filter((c) => cookieMatches(c, target));
    if (matching.length > 0) {
      headers.set(
        "Cookie",
        matching.map((c) => `${c.name}=${c.value}`).join("; "),
      );
    } else {
      headers.delete("Cookie");
    }

    const res = await fetch(current, {
      ...rest,
      headers,
      redirect: "manual",
    });

    for (const header of setCookieHeaders(res.headers)) {
      const cookie = parseSetCookie(header, target);
      if (!cookie) continue;
      const idx = jar.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain,
      );
      if (cookie.value === "" || cookie.value.toLowerCase() === "deleted") {
        if (idx >= 0) jar.splice(idx, 1);
        continue;
      }
      if (idx >= 0) jar[idx] = cookie;
      else jar.push(cookie);
    }

    if (!isRedirect(res.status)) {
      return { res };
    }

    const location = res.headers.get("location");
    if (!location) return { res };
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { res };
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return { res };
    }

    if (next.href === current) {
      sameUrlRedirects += 1;
      if (sameUrlRedirects >= SAME_URL_REDIRECT_LIMIT) {
        return { blocked: true, hops };
      }
    } else {
      sameUrlRedirects = 0;
    }

    current = next.href;
  }

  return { blocked: true, hops };
}

/**
 * Fetch a Sidearm URL, following redirects and replaying Set-Cookie.
 *
 * Cloudflare Workers have no cookie jar, so Imperva's visid_incap 301 would
 * otherwise loop. Replaying cookies is enough for some hosts; from Cloudflare
 * egress IPs, Imperva often keeps 301ing to the same URL anyway. In that case
 * (and on "Too many redirects"), load HTML from the R2 cache or Browser Run.
 *
 * JSON API requests (`Accept: application/json`) never use the HTML fallback.
 */
export async function fetchSidearm(
  url: string,
  init: FetchSidearmInit = {},
): Promise<Response> {
  const { env, htmlFallback = true, maxRedirects, ...fetchInit } = init;
  const directInit: DirectInit = { ...fetchInit, maxRedirects };
  const jsonRequest = wantsJson(fetchInit.headers);

  const fallback = async (reason: string): Promise<Response> => {
    if (!htmlFallback || jsonRequest) {
      throw new Error(reason);
    }
    return fetchViaBrowserOrCache(url, env, reason);
  };

  try {
    const outcome = await fetchDirectWithCookies(url, directInit);
    if ("res" in outcome) {
      return outcome.res;
    }
    return fallback(`Too many redirects: ${outcome.hops.join(", ")}`);
  } catch (err) {
    if (htmlFallback && !jsonRequest && isRedirectLoopError(err)) {
      return fetchViaBrowserOrCache(
        url,
        env,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}
