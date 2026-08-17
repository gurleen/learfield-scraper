/** Shared User-Agent for Sidearm / athletics site requests. */
export const SIDEARM_USER_AGENT =
  "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)";

const MAX_REDIRECTS = 20;

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
};

export type FetchSidearmInit = RequestInit & {
  maxRedirects?: number;
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

/**
 * fetch() that follows redirects and forwards Set-Cookie as Cookie on later hops.
 *
 * Cloudflare Workers (and some other runtimes) follow redirects without a cookie
 * jar. Imperva/Incapsula on Classic Sidearm sites 302s to the same URL after
 * setting visid_incap; without replaying that cookie, fetch loops until
 * "Too many redirects".
 */
export async function fetchSidearm(
  url: string,
  init: FetchSidearmInit = {},
): Promise<Response> {
  const { maxRedirects = MAX_REDIRECTS, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", SIDEARM_USER_AGENT);
  }

  const jar: StoredCookie[] = [];
  let current = url;
  const hops: string[] = [];

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
      return res;
    }

    const location = res.headers.get("location");
    if (!location) return res;
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return res;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return res;
    }
    current = next.href;
  }

  throw new Error(`Too many redirects: ${hops.join(", ")}`);
}
