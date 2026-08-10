import type { RosterResult } from "./types";

export type ExportFormat = "json" | "csv";

function csvCell(value: string | null | undefined): string {
  const s = value ?? "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: (string | null | undefined)[]): string {
  return values.map(csvCell).join(",");
}

export function rosterToJson(result: RosterResult): string {
  return JSON.stringify(result, null, 2);
}

export function rosterToCsv(result: RosterResult): string {
  const lines: string[] = [];

  lines.push(
    csvRow([
      "jerseyNumber",
      "firstName",
      "lastName",
      "position",
      "academicYear",
      "height",
      "hometown",
      "highSchool",
      "previousSchool",
      "major",
      "bioUrl",
      "headshotUrl",
    ]),
  );
  for (const p of result.players) {
    lines.push(
      csvRow([
        p.jerseyNumber,
        p.firstName,
        p.lastName,
        p.position,
        p.academicYear,
        p.height,
        p.hometown,
        p.highSchool,
        p.previousSchool,
        p.major,
        p.bioUrl,
        p.headshotUrl,
      ]),
    );
  }

  return lines.join("\n");
}

export function serializeRoster(
  result: RosterResult,
  format: ExportFormat,
): { text: string; mimeType: string; extension: string } {
  if (format === "csv") {
    return {
      text: rosterToCsv(result),
      mimeType: "text/csv;charset=utf-8",
      extension: "csv",
    };
  }
  return {
    text: rosterToJson(result),
    mimeType: "application/json",
    extension: "json",
  };
}
