export type NcaaTeam = {
  id: string;
  name: string;
  website: string;
  conference: string;
};

export const CUSTOM_SCHOOL_VALUE = "__custom__";
export const DEFAULT_SPORT_SLUG = "womens-soccer";

/** Normalize a website host/URL to an https origin (no trailing slash). */
export function originFromWebsite(website: string): string {
  const host = website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return `https://${host}`;
}

/** Build a Sidearm roster URL from an athletics site host. */
export function rosterUrlFromWebsite(
  website: string,
  sportSlug: string = DEFAULT_SPORT_SLUG,
): string {
  return `${originFromWebsite(website)}/sports/${sportSlug}/roster`;
}
