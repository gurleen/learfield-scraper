import { zipSync } from "fflate";
import { fetchOriginalImage } from "./images";
import type { Player, RosterResult } from "./types";

export type ImageNaming = "named" | "numbered";

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionFromUrl(url: string, contentType: string | null): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i);
    if (match) return match[1]!.toLowerCase().replace("jpeg", "jpg");
  } catch {
    /* ignore */
  }
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  return "jpg";
}

function namedFileBase(player: Player, index: number): string {
  const jersey = player.jerseyNumber?.trim() || String(index + 1).padStart(2, "0");
  const last = slugPart(player.lastName) || "player";
  const first = slugPart(player.firstName) || "unknown";
  return `${jersey}_${last}_${first}`;
}

function uniqueBases(
  players: Player[],
  naming: ImageNaming,
): string[] {
  const used = new Set<string>();
  return players.map((player, index) => {
    let base =
      naming === "numbered"
        ? String(index + 1)
        : namedFileBase(player, index);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    const unique = `${base}-${n}`;
    used.add(unique);
    return unique;
  });
}

export function parseImageNaming(value: unknown): ImageNaming {
  return value === "numbered" ? "numbered" : "named";
}

export async function zipPlayerHeadshots(
  result: RosterResult,
  naming: ImageNaming = "named",
): Promise<{ zip: Uint8Array; count: number; skipped: number }> {
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  let skipped = 0;

  const players = result.players.filter((p) => p.headshotUrl);
  const bases = uniqueBases(players, naming);

  await Promise.all(
    players.map(async (player, index) => {
      const url = player.headshotUrl!;
      const image = await fetchOriginalImage(url);
      if (!image) {
        skipped += 1;
        return;
      }

      const ext = extensionFromUrl(image.url, image.contentType);
      const name = `${bases[index]}.${ext}`;
      files[name] = image.bytes;
      count += 1;
    }),
  );

  if (count === 0) {
    throw new Error("No headshot images could be downloaded");
  }

  const zip = zipSync(files, { level: 0 });
  return { zip, count, skipped };
}
