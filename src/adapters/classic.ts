import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { resolveOriginalImageUrl } from "../images";
import type { Coach, Player, RosterResult } from "../types";
import { parseRosterUrl } from "../types";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; learfield-scraper/0.1; +https://github.com/gurleen/learfield-scraper)",
};

function text($el: cheerio.Cheerio<Element>): string {
  return $el.text().replace(/\s+/g, " ").trim();
}

function imgSrc($img: cheerio.Cheerio<Element>): string | null {
  const src = $img.attr("data-src") ?? $img.attr("src") ?? null;
  return src?.trim() || null;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]!,
  };
}

function parsePlayer(
  $: cheerio.CheerioAPI,
  el: Element,
  origin: string,
): Player {
  const $li = $(el);
  const jersey = text($li.find(".sidearm-roster-player-jersey-number").first());
  const nameLink = $li.find(".sidearm-roster-player-name a").first();
  const fullName = text(nameLink.length ? nameLink : $li.find(".sidearm-roster-player-name").first());
  const { firstName, lastName } = splitName(fullName);

  const position = text(
    $li.find(".sidearm-roster-player-position-long-short").first(),
  );
  const height = text($li.find(".sidearm-roster-player-height").first());
  const academicYear = text(
    $li.find(".sidearm-roster-player-academic-year").first(),
  );
  const hometown = text($li.find(".sidearm-roster-player-hometown").first());
  const highSchool = text($li.find(".sidearm-roster-player-highschool").first());
  const major = text($li.find(".sidearm-roster-player-major").first());
  const previousSchool = text(
    $li.find(".sidearm-roster-player-previous-school, .sidearm-roster-player-previous").first(),
  );

  const playerPath = $li.attr("data-player-url");
  const bioUrl = playerPath ? new URL(playerPath, origin).href : null;

  const rawImg = imgSrc($li.find(".sidearm-roster-player-image img").first());

  return {
    firstName,
    lastName,
    jerseyNumber: jersey || null,
    position: position || null,
    academicYear: academicYear || null,
    height: height || null,
    hometown: hometown || null,
    highSchool: highSchool || null,
    previousSchool: previousSchool || null,
    major: major || null,
    bioUrl,
    headshotUrl: resolveOriginalImageUrl(rawImg, origin),
  };
}

function parseCoach($: cheerio.CheerioAPI, el: Element, origin: string): Coach {
  const $li = $(el);
  const name = text($li.find(".sidearm-roster-coach-name").first());
  const title = text($li.find(".sidearm-roster-coach-title").first());
  const bioHref = $li.find(".sidearm-roster-coach-link a").attr("href");
  const bioUrl = bioHref ? new URL(bioHref, origin).href : null;
  const rawImg = imgSrc($li.find(".sidearm-roster-coach-image img").first());

  return {
    name: name || "Unknown",
    title: title || null,
    bioUrl,
    headshotUrl: resolveOriginalImageUrl(rawImg, origin),
  };
}

export async function scrapeClassic(rosterUrl: string): Promise<RosterResult> {
  const { origin, sportSlug, normalizedUrl } = parseRosterUrl(rosterUrl);

  const res = await fetch(normalizedUrl, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch roster page (${res.status})`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const players: Player[] = [];
  $("li.sidearm-roster-player").each((_, el) => {
    players.push(parsePlayer($, el, origin));
  });

  const coaches: Coach[] = [];
  $("li.sidearm-roster-coach").each((_, el) => {
    coaches.push(parseCoach($, el, origin));
  });

  const title =
    text($("h1").first()) ||
    text($(".sidearm-roster-header h1").first()) ||
    null;

  const season =
    $("select#sidearm-roster-select-year option[selected]").text().trim() ||
    $("select.sidearm-roster-select-year option[selected]").text().trim() ||
    null;

  return {
    sourceUrl: normalizedUrl,
    platform: "classic",
    schoolHost: new URL(origin).host,
    sportSlug,
    title,
    season: season || null,
    players,
    coaches,
  };
}

export function htmlLooksClassic(html: string): boolean {
  return html.includes("sidearm-roster-player");
}
