import { isNextGen, scrapeNextGen } from "./adapters/nextgen";
import { htmlLooksClassic, scrapeClassic } from "./adapters/classic";
import { fetchSidearm, SIDEARM_USER_AGENT, type FetchSidearmEnv } from "./fetch";
import type { RosterResult } from "./types";
import { parseRosterUrl } from "./types";

export async function scrapeRoster(
  rosterUrl: string,
  env?: FetchSidearmEnv,
): Promise<RosterResult> {
  const { origin } = parseRosterUrl(rosterUrl);

  if (await isNextGen(origin, env)) {
    return scrapeNextGen(rosterUrl, env);
  }

  const { normalizedUrl } = parseRosterUrl(rosterUrl);
  const res = await fetchSidearm(normalizedUrl, {
    env,
    headers: {
      "User-Agent": SIDEARM_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch roster page (${res.status})`);
  }
  const html = await res.text();

  if (htmlLooksClassic(html)) {
    return scrapeClassic(rosterUrl, html);
  }

  throw new Error(
    "Unsupported roster page: not Sidearm NextGen (API) or Classic (HTML roster list).",
  );
}
