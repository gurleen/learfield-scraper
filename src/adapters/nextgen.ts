import { fetchSidearm, SIDEARM_USER_AGENT } from "../fetch";
import { resolveOriginalImageUrl } from "../images";
import type { Coach, Player, RosterResult } from "../types";
import { parseRosterUrl } from "../types";

type SidearmSport = {
  id: number;
  title: string;
  globalSportNameSlug: string;
  rosterId?: number;
};

type SidearmImage = {
  url?: string | null;
  absoluteUrl?: string | null;
};

type SidearmPlayer = {
  firstName: string;
  lastName: string;
  jerseyNumber?: string | null;
  positionShort?: string | null;
  academicYearShort?: string | null;
  heightFeet?: number | null;
  heightInches?: number | null;
  hometown?: string | null;
  highSchool?: string | null;
  previousSchool?: string | null;
  major?: string | null;
  image?: SidearmImage | null;
  rosterPlayerId?: number;
};

type SidearmCoach = {
  firstName?: string;
  lastName?: string;
  title?: string | null;
  image?: SidearmImage | null;
  staffId?: number;
};

type SidearmRoster = {
  id: number;
  displayTitle?: string | null;
  season?: { title?: string | null } | null;
  players?: SidearmPlayer[];
  coaches?: SidearmCoach[];
};

type RostersListResponse = {
  items?: SidearmRoster[];
};

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": SIDEARM_USER_AGENT,
};

function formatHeight(feet: number | null | undefined, inches: number | null | undefined): string | null {
  if (feet == null && inches == null) return null;
  const f = feet ?? 0;
  const i = inches ?? 0;
  if (f === 0 && i === 0) return null;
  return `${f}' ${i}''`;
}

function playerHeadshot(p: SidearmPlayer, origin: string): string | null {
  const raw = p.image?.absoluteUrl ?? p.image?.url ?? null;
  return resolveOriginalImageUrl(raw, origin);
}

function coachName(c: SidearmCoach): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(" ").trim() || "Unknown";
}

function slugifyName(first: string, last: string): string {
  return `${first}-${last}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mapPlayer(p: SidearmPlayer, origin: string, sportSlug: string): Player {
  const bioUrl =
    p.rosterPlayerId != null
      ? `${origin}/sports/${sportSlug}/roster/${slugifyName(p.firstName ?? "", p.lastName ?? "")}/${p.rosterPlayerId}`
      : null;

  const firstName = p.firstName ?? "";
  const lastName = p.lastName ?? "";
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" ").trim(),
    jerseyNumber: p.jerseyNumber?.trim() || null,
    position: p.positionShort?.trim() || null,
    academicYear: p.academicYearShort?.trim() || null,
    height: formatHeight(p.heightFeet, p.heightInches),
    hometown: p.hometown?.trim() || null,
    highSchool: p.highSchool?.trim() || null,
    previousSchool: p.previousSchool?.trim() || null,
    major: p.major?.trim() || null,
    bioUrl,
    headshotUrl: playerHeadshot(p, origin),
  };
}

function mapCoach(c: SidearmCoach, origin: string): Coach {
  const raw = c.image?.absoluteUrl ?? c.image?.url ?? null;
  return {
    name: coachName(c),
    title: c.title?.trim() || null,
    bioUrl:
      c.staffId != null ? `${origin}/sports/staff-directory/bios/${c.staffId}` : null,
    headshotUrl: resolveOriginalImageUrl(raw, origin),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchSidearm(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`NextGen API failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function scrapeNextGen(rosterUrl: string): Promise<RosterResult> {
  const { origin, sportSlug, normalizedUrl } = parseRosterUrl(rosterUrl);

  const sports = await fetchJson<SidearmSport[]>(`${origin}/api/v2/Sports`);
  const sport = sports.find((s) => s.globalSportNameSlug === sportSlug);
  if (!sport) {
    throw new Error(`Sport "${sportSlug}" not found on ${origin}`);
  }

  const list = await fetchJson<RostersListResponse>(
    `${origin}/api/v2/Rosters?sportId=${sport.id}`,
  );
  const roster = list.items?.[0];
  if (!roster) {
    throw new Error(`No roster found for sport id ${sport.id}`);
  }

  let detail = roster;
  if (!roster.players?.length && roster.id) {
    detail = await fetchJson<SidearmRoster>(`${origin}/api/v2/Rosters/${roster.id}`);
  }

  const players = (detail.players ?? []).map((p) => mapPlayer(p, origin, sportSlug));
  const coaches = (detail.coaches ?? []).map((c) => mapCoach(c, origin));

  return {
    sourceUrl: normalizedUrl,
    platform: "nextgen",
    schoolHost: new URL(origin).host,
    sportSlug,
    title: detail.displayTitle?.trim() || null,
    season: detail.season?.title?.trim() || null,
    players,
    coaches,
  };
}

export async function isNextGen(origin: string): Promise<boolean> {
  try {
    const res = await fetchSidearm(`${origin}/api/v2/Sports`, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data);
  } catch {
    return false;
  }
}
