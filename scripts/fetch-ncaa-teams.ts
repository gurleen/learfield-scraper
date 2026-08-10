/**
 * Refresh src/data/ncaa-teams.json from LiveStatsManager espn_teams.csv.
 * Usage: bun ./scripts/fetch-ncaa-teams.ts
 */
const SOURCE =
  "https://raw.githubusercontent.com/gurleen/LiveStatsManager/refs/heads/main/LiveStatsManager/espn_teams.csv";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
const text = await res.text();
const [header, ...body] = parseCsv(text);
if (!header) throw new Error("Empty CSV");

const idx = (name: string) => header.indexOf(name);
const iId = idx("team_id");
const iTeam = idx("team");
const iDisplay = idx("display_name");
const iConf = idx("conference_short_name");
const iSite = idx("website");

const teams = body
  .map((cols) => {
    const website = (cols[iSite] ?? "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    if (!website) return null;
    const name = (cols[iTeam] ?? cols[iDisplay] ?? "").trim();
    if (!name) return null;
    return {
      id: (cols[iId] ?? "").trim(),
      name,
      website,
      conference: (cols[iConf] ?? "").trim(),
    };
  })
  .filter((t): t is NonNullable<typeof t> => !!t)
  .sort((a, b) => a.name.localeCompare(b.name));

const out = `${import.meta.dir}/../src/data/ncaa-teams.json`;
await Bun.write(out, `${JSON.stringify(teams, null, 2)}\n`);
console.log(`Wrote ${teams.length} teams to ${out}`);
