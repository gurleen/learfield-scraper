import * as cheerio from "cheerio";
import { fetchSidearm, SIDEARM_USER_AGENT } from "./fetch";
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

async function listNextGenSports(origin: string): Promise<SportOption[] | null> {
  try {
    const res = await fetchSidearm(`${origin}/api/v2/Sports`, {
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

async function listClassicSports(origin: string): Promise<SportOption[]> {
  const candidates = [
    `${origin}/`,
    `${origin}/sports/${DEFAULT_SPORT_SLUG}/roster`,
  ];
  let html: string | null = null;
  let lastStatus = 0;

  for (const url of candidates) {
    try {
      const res = await fetchSidearm(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      lastStatus = res.status;
      if (res.ok) {
        html = await res.text();
        break;
      }
    } catch {
      lastStatus = 0;
    }
  }

  if (!html) {
    throw new Error(`Failed to fetch athletics site (${lastStatus})`);
  }

  const $ = cheerio.load(html);
  const bySlug = new Map<string, SportOption>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let pathname: string;
    try {
      pathname = new URL(href, origin).pathname;
    } catch {
      return;
    }
    const match = pathname.match(/^\/sports\/([a-z0-9-]+)\/?$/i);
    if (!match) return;
    const slug = match[1]!.toLowerCase();
    if (bySlug.has(slug)) return;
    bySlug.set(slug, { slug, title: titleFromSlug(slug) });
  });

  return sortSports([...bySlug.values()]);
}

/** List sports with rosters for a Sidearm athletics site. */
export async function listSports(website: string): Promise<SportOption[]> {
  const origin = originFromWebsite(website);
  const nextGen = await listNextGenSports(origin);
  if (nextGen && nextGen.length > 0) {
    return nextGen;
  }
  try {
    return withFallback(await listClassicSports(origin));
  } catch (err) {
    if (nextGen) return withFallback(nextGen);
    throw err;
  }
}
