const RESIZE_PARAMS = new Set([
  "width",
  "height",
  "quality",
  "mode",
  "anchor",
  "gravity",
  "type",
  "format",
]);

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)",
  // Do not advertise WebP — Sidearm's convert CDN keys off Accept.
  Accept: "image/jpeg,image/png,image/gif,*/*",
};

const MAX_REDIRECTS = 8;

export function isSidearmImageCdn(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "images.sidearmdev.com" || host.endsWith(".images.sidearmdev.com")
  );
}

function stripResizeParams(parsed: URL): string {
  for (const key of [...parsed.searchParams.keys()]) {
    if (RESIZE_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  const qs = parsed.searchParams.toString();
  return qs
    ? `${parsed.origin}${parsed.pathname}?${qs}`
    : `${parsed.origin}${parsed.pathname}`;
}

/** If this is a Sidearm convert/CDN URL, return the embedded origin asset URL. */
export function unwrapSidearmCdnUrl(parsed: URL): string | null {
  if (!isSidearmImageCdn(parsed.hostname)) return null;
  const embedded = parsed.searchParams.get("url");
  if (!embedded) return null;
  try {
    return new URL(embedded).href;
  } catch {
    try {
      return new URL(decodeURIComponent(embedded)).href;
    } catch {
      return embedded;
    }
  }
}

export function resolveOriginalImageUrl(
  raw: string | null | undefined,
  pageOrigin: string,
): string | null {
  if (!raw?.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim(), pageOrigin);
  } catch {
    return null;
  }

  const seen = new Set<string>();
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const unwrapped = unwrapSidearmCdnUrl(parsed);
    if (!unwrapped || seen.has(unwrapped)) break;
    seen.add(unwrapped);
    try {
      parsed = new URL(unwrapped);
    } catch {
      return unwrapped;
    }
  }

  return stripResizeParams(parsed);
}

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* already consumed or unsupported */
  }
}

/**
 * Download image bytes from the origin asset, never from Sidearm's convert CDN.
 * School-host `/images/…` URLs 302 to `images.sidearmdev.com/convert?url=…&type=webp`;
 * we unwrap that `url` (typically CloudFront) and fetch it instead.
 */
export async function fetchOriginalImage(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string | null; url: string } | null> {
  let current = url.trim();
  if (!current) return null;

  const seen = new Set<string>();

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const resolved = resolveOriginalImageUrl(current, current);
      if (!resolved) return null;
      current = resolved;

      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return null;
      }

      if (isSidearmImageCdn(parsed.hostname)) {
        return null;
      }

      if (seen.has(current)) return null;
      seen.add(current);

      const res = await fetch(current, {
        headers: FETCH_HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await cancelBody(res);
        if (!location) return null;
        current = new URL(location, current).href;
        continue;
      }

      if (!res.ok) {
        await cancelBody(res);
        return null;
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) return null;
      return {
        bytes: buf,
        contentType: res.headers.get("content-type"),
        url: current,
      };
    }
  } catch {
    return null;
  }

  return null;
}
