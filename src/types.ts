export type Player = {
  firstName: string;
  lastName: string;
  jerseyNumber: string | null;
  position: string | null;
  academicYear: string | null;
  height: string | null;
  hometown: string | null;
  highSchool: string | null;
  previousSchool: string | null;
  major: string | null;
  bioUrl: string | null;
  headshotUrl: string | null;
};

export type Coach = {
  name: string;
  title: string | null;
  bioUrl: string | null;
  headshotUrl: string | null;
};

export type RosterResult = {
  sourceUrl: string;
  platform: "nextgen" | "classic";
  schoolHost: string;
  sportSlug: string;
  title: string | null;
  season: string | null;
  players: Player[];
  coaches: Coach[];
};

export type Platform = "nextgen" | "classic";

export function parseRosterUrl(url: string): {
  origin: string;
  sportSlug: string;
  normalizedUrl: string;
} {
  const parsed = new URL(url.trim());
  const match = parsed.pathname.match(/\/sports\/([^/]+)\/roster\/?$/i);
  if (!match) {
    throw new Error(
      "URL must be a Sidearm roster page like https://school.edu/sports/womens-soccer/roster",
    );
  }
  const sportSlug = match[1]!;
  const normalizedUrl = `${parsed.origin}/sports/${sportSlug}/roster`;
  return { origin: parsed.origin, sportSlug, normalizedUrl };
}
