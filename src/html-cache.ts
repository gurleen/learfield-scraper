/** R2 prefix for Imperva fallback HTML. Must not be served via `/models/`. */
export const HTML_CACHE_PREFIX = "html-cache/";

export const HTML_CACHE_HOMEPAGE_TTL_SECONDS = 24 * 60 * 60;
export const HTML_CACHE_ROSTER_TTL_SECONDS = 6 * 60 * 60;

export type HtmlCacheStore = {
  get(key: string): Promise<{
    text(): Promise<string>;
    customMetadata?: Record<string, string> | null;
  } | null>;
  put(
    key: string,
    value: string,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<unknown>;
};

export function isHtmlCacheKey(key: string): boolean {
  return key === "html-cache" || key.startsWith(HTML_CACHE_PREFIX);
}

export function htmlCacheTtlSeconds(url: string): number {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    if (/^\/sports\/[^/]+\/roster$/i.test(pathname)) {
      return HTML_CACHE_ROSTER_TTL_SECONDS;
    }
  } catch {
    /* ignore */
  }
  return HTML_CACHE_HOMEPAGE_TTL_SECONDS;
}

export async function htmlCacheKey(url: string): Promise<string> {
  const host = new URL(url).hostname.toLowerCase();
  const hash = await sha256Hex(url);
  return `${HTML_CACHE_PREFIX}${host}/${hash}.html`;
}

export function htmlCacheIsFresh(
  metadata: Record<string, string> | null | undefined,
  now = Date.now(),
): boolean {
  if (!metadata) return false;
  const fetchedAt = Date.parse(metadata["fetched-at"] ?? "");
  const ttl = Number(metadata["ttl-seconds"] ?? "0");
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(ttl) || ttl <= 0) {
    return false;
  }
  return now - fetchedAt < ttl * 1000;
}

export async function readCachedHtml(
  store: HtmlCacheStore | undefined,
  url: string,
): Promise<string | null> {
  if (!store) return null;
  try {
    const object = await store.get(await htmlCacheKey(url));
    if (!object) return null;
    if (!htmlCacheIsFresh(object.customMetadata ?? null)) return null;
    const html = await object.text();
    return html || null;
  } catch {
    return null;
  }
}

export async function writeCachedHtml(
  store: HtmlCacheStore | undefined,
  url: string,
  html: string,
): Promise<void> {
  if (!store || !html) return;
  const key = await htmlCacheKey(url);
  await store.put(key, html, {
    customMetadata: {
      "source-url": url,
      "fetched-at": new Date().toISOString(),
      "ttl-seconds": String(htmlCacheTtlSeconds(url)),
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
