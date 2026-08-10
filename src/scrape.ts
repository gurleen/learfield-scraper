import { isNextGen, scrapeNextGen } from "./adapters/nextgen";
import { htmlLooksClassic, scrapeClassic } from "./adapters/classic";
import type { RosterResult } from "./types";
import { parseRosterUrl } from "./types";

export async function scrapeRoster(rosterUrl: string): Promise<RosterResult> {
  const { origin } = parseRosterUrl(rosterUrl);

  if (await isNextGen(origin)) {
    return scrapeNextGen(rosterUrl);
  }

  const { normalizedUrl } = parseRosterUrl(rosterUrl);
  const res = await fetch(normalizedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch roster page (${res.status})`);
  }
  const html = await res.text();

  if (htmlLooksClassic(html)) {
    return scrapeClassic(rosterUrl);
  }

  throw new Error(
    "Unsupported roster page: not Sidearm NextGen (API) or Classic (HTML roster list).",
  );
}
