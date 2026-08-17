import { isHtmlCacheKey } from "./html-cache";

/**
 * Map a `/models/...` request path to an R2 object key.
 * Returns null for missing, traversal, or private (`html-cache/`) keys.
 */
export function publicModelKey(pathname: string): string | null {
  if (pathname === "/models" || pathname === "/models/") return null;
  if (!pathname.startsWith("/models/")) return null;
  const key = pathname.slice("/models/".length);
  if (!key || key.includes("..")) return null;
  if (isHtmlCacheKey(key)) return null;
  return key;
}
