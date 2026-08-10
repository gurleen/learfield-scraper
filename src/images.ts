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

export function resolveOriginalImageUrl(
  raw: string | null | undefined,
  pageOrigin: string,
): string | null {
  if (!raw?.trim()) return null;

  let absolute: string;
  try {
    absolute = new URL(raw.trim(), pageOrigin).href;
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  if (parsed.hostname === "images.sidearmdev.com") {
    const embedded = parsed.searchParams.get("url");
    if (embedded) {
      try {
        return new URL(decodeURIComponent(embedded)).href;
      } catch {
        return embedded;
      }
    }
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (RESIZE_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }

  const qs = parsed.searchParams.toString();
  return qs ? `${parsed.origin}${parsed.pathname}?${qs}` : `${parsed.origin}${parsed.pathname}`;
}
