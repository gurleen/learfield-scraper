/** Shared User-Agent for Sidearm / athletics site requests. */
export const SIDEARM_USER_AGENT =
  "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)";

/**
 * When Cloudflare Worker egress is blocked by Imperva (same-URL 301 loop even
 * after replaying visid_incap), fetch HTML through a reader that retrieves the
 * page from a non-Cloudflare IP.
 */
export const DEFAULT_HTML_PROXY = "https://r.jina.ai/";

const MAX_REDIRECTS = 20;
const SAME_URL_REDIRECT_LIMIT = 2;

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
};

export type FetchSidearmInit = RequestInit & {
  maxRedirects?: number;
  /** Reader prefix, or `false` to disable the Imperva fallback. */
  htmlProxy?: string | false;
};

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

async function fetchViaHtmlProxy(
  url: string,
  proxyPrefix: string,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  const prefix = proxyPrefix.endsWith("/") ? proxyPrefix : `${proxyPrefix}/`;
  const res = await fetch(`${prefix}${url}`, {
    headers: {
      "User-Agent": SIDEARM_USER_AGENT,
      "X-Return-Format": "html",
      Accept: "text/html,text/plain,*/*",
    },
    signal: signal ?? undefined,
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Athletics site blocked Worker fetch; HTML proxy failed (${res.status})`,
    );
  }
  const html = await res.text();
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function fetchDirectWithCookies(
  url: string,
  init: FetchSidearmInit,
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
 * (and on "Too many redirects"), fall back to DEFAULT_HTML_PROXY.
 */
export async function fetchSidearm(
  url: string,
  init: FetchSidearmInit = {},
): Promise<Response> {
  const { htmlProxy = DEFAULT_HTML_PROXY, ...rest } = init;

  const tryProxy = async (reason: string): Promise<Response> => {
    if (htmlProxy === false) {
      throw new Error(reason);
    }
    return fetchViaHtmlProxy(url, htmlProxy, rest.signal);
  };

  try {
    const outcome = await fetchDirectWithCookies(url, rest);
    if ("res" in outcome) {
      return outcome.res;
    }
    return tryProxy(`Too many redirects: ${outcome.hops.join(", ")}`);
  } catch (err) {
    if (htmlProxy !== false && isRedirectLoopError(err)) {
      return fetchViaHtmlProxy(url, htmlProxy, rest.signal);
    }
    throw err;
  }
}
