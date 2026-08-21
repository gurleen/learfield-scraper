import * as cheerio from "cheerio";
import { fetchSidearm, SIDEARM_USER_AGENT, type FetchSidearmEnv } from "./fetch";
import {
  DEFAULT_SPORT_SLUG,
  originFromWebsite,
} from "./ncaa-teams";

export type SportOption = {
  slug: string;
  title: string;
};

type SidearmSport = {
  title?: string;
  globalSportNameSlug?: string;
  nonSport?: boolean;
  rosterId?: number | null;
};

const FETCH_HEADERS = {
  "User-Agent": SIDEARM_USER_AGENT,
};

const FALLBACK_SPORT: SportOption = {
  slug: DEFAULT_SPORT_SLUG,
  title: "Women's Soccer",
};

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => {
      if (part === "mens") return "Men's";
      if (part === "womens") return "Women's";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function sortSports(sports: SportOption[]): SportOption[] {
  return [...sports].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

function withFallback(sports: SportOption[]): SportOption[] {
  if (sports.length > 0) return sports;
  return [FALLBACK_SPORT];
}

/** Sidearm interstitial (tickets, season launch) — not a sports nav page. */
export function isAthleticsSplashUrl(url: string): boolean {
  try {
    return /\/splash\.aspx$/i.test(new URL(url).pathname);
  } catch {
    return /splash\.aspx/i.test(url);
  }
}

/**
 * Collect roster sports from Classic Sidearm HTML.
 * Prefers `/sports/{slug}/roster` links; otherwise uses `/sports/{slug}`.
 */
export function collectClassicSports(
  html: string,
  origin: string,
): SportOption[] {
  const $ = cheerio.load(html);
  const indexSlugs = new Set<string>();
  const rosterSlugs = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let pathname: string;
    try {
      pathname = new URL(href, origin).pathname;
    } catch {
      return;
    }
    const roster = pathname.match(/^\/sports\/([a-z0-9-]+)\/roster\/?$/i);
    if (roster) {
      rosterSlugs.add(roster[1]!.toLowerCase());
      return;
    }
    const index = pathname.match(/^\/sports\/([a-z0-9-]+)\/?$/i);
    if (index) indexSlugs.add(index[1]!.toLowerCase());
  });

  // Roster links are the real sport slugs; index-only hrefs can be truncated
  // (Wagner's `/sports/flagf`) or non-roster clubs (dance, band).
  const slugs = rosterSlugs.size > 0 ? rosterSlugs : indexSlugs;
  return sortSports(
    [...slugs].map((slug) => ({ slug, title: titleFromSlug(slug) })),
  );
}

async function listNextGenSports(
  origin: string,
  env?: FetchSidearmEnv,
): Promise<SportOption[] | null> {
  try {
    const res = await fetchSidearm(`${origin}/api/v2/Sports`, {
      env,
      headers: {
        ...FETCH_HEADERS,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;

    const bySlug = new Map<string, SportOption>();
    for (const raw of data as SidearmSport[]) {
      const slug = raw.globalSportNameSlug?.trim();
      if (!slug) continue;
      if (raw.nonSport) continue;
      if (raw.rosterId == null) continue;
      bySlug.set(slug, {
        slug,
        title: raw.title?.trim() || titleFromSlug(slug),
      });
    }
    return sortSports([...bySlug.values()]);
  } catch {
    return null;
  }
}

export async function listClassicSports(
  origin: string,
  env?: FetchSidearmEnv,
): Promise<SportOption[]> {
  const candidates = [
    `${origin}/`,
    `${origin}/sports/${DEFAULT_SPORT_SLUG}/roster`,
  ];
  let lastStatus = 0;
  let lastError: unknown;
  let fetchedOk = false;

  for (const url of candidates) {
    try {
      const res = await fetchSidearm(url, {
        env,
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      fetchedOk = true;
      if (res.url && isAthleticsSplashUrl(res.url)) {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        continue;
      }
      const found = collectClassicSports(await res.text(), origin);
      if (found.length > 0) return found;
    } catch (err) {
      lastError = err;
    }
  }

  if (!fetchedOk) {
    const detail =
      lastError instanceof Error
        ? lastError.message
        : lastStatus
          ? `HTTP ${lastStatus}`
          : "no response";
    throw new Error(`Failed to fetch athletics site (${detail})`);
  }

  return [];
}

/** List sports with rosters for a Sidearm athletics site. */
export async function listSports(
  website: string,
  env?: FetchSidearmEnv,
): Promise<SportOption[]> {
  const origin = originFromWebsite(website);
  const nextGen = await listNextGenSports(origin, env);
  if (nextGen && nextGen.length > 0) {
    return nextGen;
  }
  try {
    return withFallback(await listClassicSports(origin, env));
  } catch (err) {
    if (nextGen) return withFallback(nextGen);
    throw err;
  }
}
