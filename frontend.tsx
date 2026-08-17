import "@hydra-tv/tokens";
import {
  Button,
  Checkbox,
  Combobox,
  DataGrid,
  Dialog,
  Input,
  NavBar,
  Panel,
  ProgressBar,
  Spinner,
  Tabs,
  ToastProvider,
  useToast,
} from "@hydra-tv/ui";
import { unzipSync, zipSync } from "fflate";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ExportFormat } from "./src/export";
import { serializeRoster } from "./src/export";
import type { ImageNaming } from "./src/zip-images";
import type { Coach, Player, RosterResult } from "./src/types";
import ncaaTeamsJson from "./src/data/ncaa-teams.json";
import {
  CUSTOM_SCHOOL_VALUE,
  DEFAULT_SPORT_SLUG,
  rosterUrlFromWebsite,
  type NcaaTeam,
} from "./src/ncaa-teams";
import type { SportOption } from "./src/sports";

const NCAA_TEAMS = ncaaTeamsJson as NcaaTeam[];

const SCHOOL_OPTIONS = [
  ...NCAA_TEAMS.map((t) => ({
    value: t.id,
    label: t.conference ? `${t.name} (${t.conference})` : t.name,
  })),
  { value: CUSTOM_SCHOOL_VALUE, label: "Custom URL…" },
];

function toPngName(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".png";
}

type BgJob =
  | { phase: "fetch" }
  | { phase: "model" }
  | { phase: "process"; done: number; total: number; current: string }
  | { phase: "pack" };

function bgJobLabel(job: BgJob): string {
  switch (job.phase) {
    case "fetch":
      return "Downloading headshots";
    case "model":
      return "Loading RMBG-1.4 model";
    case "process":
      return `Removing background ${job.done}/${job.total}`;
    case "pack":
      return "Packing ZIP";
  }
}

function bgJobDetail(job: BgJob): string | undefined {
  switch (job.phase) {
    case "fetch":
      return "Fetching images from the server…";
    case "model":
      return "First use downloads ~44MB (cached after)";
    case "process":
      return job.current;
    case "pack":
      return "Building download…";
  }
}

const ROSTER_GRID_STYLE = { "--row-h": "56px" } as CSSProperties;
const HEADSHOT_SIZE = 48;

function HeadshotThumb({ url }: { url: unknown }) {
  if (!url) return <>—</>;
  return (
    <img
      src={String(url)}
      alt=""
      width={HEADSHOT_SIZE}
      height={HEADSHOT_SIZE}
      style={{ objectFit: "cover", borderRadius: 2, display: "block" }}
    />
  );
}

function AppInner() {
  const toast = useToast();
  const [schoolId, setSchoolId] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [sportSlug, setSportSlug] = useState(DEFAULT_SPORT_SLUG);
  const [sportOptions, setSportOptions] = useState<SportOption[]>([]);
  const [sportsLoading, setSportsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [zipping, setZipping] = useState(false);
  const [imageNaming, setImageNaming] = useState<ImageNaming>("named");
  const [removeBg, setRemoveBg] = useState(false);
  const [bgJob, setBgJob] = useState<BgJob | null>(null);
  const [result, setResult] = useState<RosterResult | null>(null);

  const selectedTeam = useMemo(
    () => NCAA_TEAMS.find((t) => t.id === schoolId) ?? null,
    [schoolId],
  );
  const isCustom = schoolId === CUSTOM_SCHOOL_VALUE;
  const url = isCustom
    ? customUrl.trim()
    : selectedTeam
      ? rosterUrlFromWebsite(selectedTeam.website, sportSlug)
      : "";

  useEffect(() => {
    if (!selectedTeam || isCustom) {
      setSportOptions([]);
      setSportSlug(DEFAULT_SPORT_SLUG);
      setSportsLoading(false);
      return;
    }

    const website = selectedTeam.website;
    let cancelled = false;
    setSportsLoading(true);
    setSportOptions([]);
    setSportSlug(DEFAULT_SPORT_SLUG);

    (async () => {
      try {
        const res = await fetch(
          `/api/sports?website=${encodeURIComponent(website)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? `Sports lookup failed (${res.status})`);
        }
        if (cancelled) return;
        const sports = (data.sports ?? []) as SportOption[];
        setSportOptions(sports);
        const preferred =
          sports.find((s) => s.slug === DEFAULT_SPORT_SLUG) ?? sports[0];
        setSportSlug(preferred?.slug ?? DEFAULT_SPORT_SLUG);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Sports lookup failed";
        toast.show({
          message: "Could not load sports",
          detail: message,
          level: "err",
        });
        setSportOptions([{ slug: DEFAULT_SPORT_SLUG, title: "Women's Soccer" }]);
        setSportSlug(DEFAULT_SPORT_SLUG);
      } finally {
        if (!cancelled) setSportsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTeam, isCustom, toast]);

  const scrape = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setResult(data as RosterResult);
      toast.show({ message: "Roster loaded", level: "ok" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Scrape failed";
      toast.show({ message: "Scrape failed", detail: message, level: "err" });
    } finally {
      setLoading(false);
    }
  }, [url, toast]);

  const copyExport = useCallback(async () => {
    if (!result) return;
    const { text } = serializeRoster(result, exportFormat);
    await navigator.clipboard.writeText(text);
    toast.show({
      message: exportFormat === "csv" ? "Copied CSV" : "Copied JSON",
      level: "ok",
    });
  }, [result, exportFormat, toast]);

  const downloadExport = useCallback(() => {
    if (!result) return;
    const { text, mimeType, extension } = serializeRoster(result, exportFormat);
    const blob = new Blob([text], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${result.schoolHost}-${result.sportSlug}-roster.${extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.show({ message: "Download started", level: "ok" });
  }, [result, exportFormat, toast]);

  const downloadHeadshotsZip = useCallback(async () => {
    if (!result) return;
    const withShots = result.players.filter((p) => p.headshotUrl).length;
    if (withShots === 0) {
      toast.show({
        message: "No headshots",
        detail: "This roster has no player image URLs",
        level: "warn",
      });
      return;
    }
    setZipping(true);
    setBgJob(removeBg ? { phase: "fetch" } : null);
    try {
      const res = await fetch("/api/zip-headshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster: result, naming: imageNaming }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Zip failed (${res.status})`);
      }

      let outBlob = await res.blob();
      let detail = res.headers.get("X-Headshot-Count")
        ? `${res.headers.get("X-Headshot-Count")} files in zip`
        : undefined;

      if (removeBg) {
        setBgJob({ phase: "model" });
        const { removeImageBackground, loadBackgroundRemover } = await import(
          "./src/browser/remove-background"
        );
        // Trigger model load before the loop so the modal stays on "model"
        // until weights are ready, then flips to per-image progress.
        await loadBackgroundRemover();

        const unzipped = unzipSync(new Uint8Array(await outBlob.arrayBuffer()));
        const names = Object.keys(unzipped);
        const processed: Record<string, Uint8Array> = {};
        let failed = 0;
        setBgJob({
          phase: "process",
          done: 0,
          total: names.length,
          current: names[0] ?? "",
        });

        for (let i = 0; i < names.length; i++) {
          const name = names[i]!;
          const bytes = unzipped[name]!;
          try {
            const png = await removeImageBackground(bytes);
            processed[toPngName(name)] = png;
          } catch (err) {
            console.warn(`Background removal failed for ${name}:`, err);
            processed[name] = bytes;
            failed += 1;
          }
          setBgJob({
            phase: "process",
            done: i + 1,
            total: names.length,
            current: names[i + 1] ?? name,
          });
        }

        setBgJob({ phase: "pack" });
        outBlob = new Blob([zipSync(processed, { level: 0 })], {
          type: "application/zip",
        });
        detail = `${names.length - failed} cutouts${
          failed ? `, ${failed} kept original` : ""
        }`;
      }

      const a = document.createElement("a");
      a.href = URL.createObjectURL(outBlob);
      a.download = `${result.schoolHost}-${result.sportSlug}-headshots.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.show({
        message: "Images downloaded",
        detail,
        level: "ok",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Zip failed";
      toast.show({ message: "Image zip failed", detail: message, level: "err" });
    } finally {
      setZipping(false);
      setBgJob(null);
    }
  }, [result, imageNaming, removeBg, toast]);

  const playerRows = useMemo(() => {
    if (!result) return [];
    return result.players.map((p: Player) => ({
      jersey: p.jerseyNumber ?? "",
      name: p.fullName,
      position: p.position ?? "",
      year: p.academicYear ?? "",
      hometown: p.hometown ?? "",
      highSchool: p.highSchool ?? "",
      headshot: p.headshotUrl ?? "",
      bio: p.bioUrl ?? "",
    }));
  }, [result]);

  const coachRows = useMemo(() => {
    if (!result) return [];
    return result.coaches.map((c: Coach) => ({
      name: c.name,
      title: c.title ?? "",
      headshot: c.headshotUrl ?? "",
      bio: c.bioUrl ?? "",
    }));
  }, [result]);

  return (
    <div style={{ position: "relative", minHeight: "100vh", color: "var(--fg-1)" }}>
      <NavBar
        brand={
          <span style={{ fontWeight: 700, letterSpacing: "0.12em" }}>
            ROSTER SCRAPER
          </span>
        }
      />

      <Dialog
        open={bgJob !== null}
        title="REMOVE BACKGROUND"
        message={bgJob ? bgJobLabel(bgJob) : undefined}
        detail={bgJob ? bgJobDetail(bgJob) : undefined}
        width={420}
        cancelLabel={null}
        confirmLabel="WORKING…"
        onConfirm={() => {}}
      >
        {bgJob && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {bgJob.phase === "process" ? (
              <>
                <ProgressBar
                  label={`${Math.round((bgJob.done / Math.max(bgJob.total, 1)) * 100)}%`}
                  value={(bgJob.done / Math.max(bgJob.total, 1)) * 100}
                  height={8}
                />
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fg-2)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {bgJob.done} of {bgJob.total} images
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Spinner />
                <ProgressBar indeterminate label="In progress" height={8} />
              </div>
            )}
          </div>
        )}
      </Dialog>

      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "var(--sp-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-6)",
        }}
      >
        <Panel title="Roster" meta="Sidearm / Learfield sites">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "flex-end",
            }}
          >
            <Combobox
              label="School"
              value={schoolId}
              options={SCHOOL_OPTIONS}
              onChange={setSchoolId}
              width={320}
              placeholder="Select a school…"
              clearable
            />
            {!isCustom && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <Combobox
                  label="Sport"
                  value={sportSlug}
                  options={sportOptions.map((s) => ({
                    value: s.slug,
                    label: s.title,
                  }))}
                  onChange={setSportSlug}
                  width={220}
                  disabled={sportsLoading || sportOptions.length === 0 || !selectedTeam}
                  placeholder={sportsLoading ? "Loading…" : "Select a sport…"}
                />
                {sportsLoading && <Spinner />}
              </div>
            )}
            {isCustom ? (
              <Input
                label="URL"
                value={customUrl}
                onChange={setCustomUrl}
                placeholder="https://example.com/sports/womens-soccer/roster"
                width="100%"
                style={{ flex: "1 1 320px", minWidth: 280 }}
              />
            ) : (
              <div
                style={{
                  flex: "1 1 280px",
                  minWidth: 200,
                  fontSize: 11,
                  color: "var(--fg-2)",
                  fontFamily: "var(--font-mono)",
                  paddingBottom: 6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={url || undefined}
              >
                {url || "Pick a school or choose Custom URL…"}
              </div>
            )}
            <Button
              label={loading ? "Scraping…" : "Scrape"}
              variant="accent"
              disabled={loading || !url || (!isCustom && sportsLoading)}
              onClick={scrape}
            />
          </div>
        </Panel>

        {loading && (
          <Panel title="Loading">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Spinner />
              <span style={{ fontSize: 11, color: "var(--fg-2)" }}>
                Fetching roster…
              </span>
            </div>
          </Panel>
        )}

        {result && !loading && (
          <Panel
            title={result.title ?? "Roster"}
            meta={`${result.schoolHost} · ${result.platform} · ${result.players.length} players · ${result.coaches.length} coaches${result.season ? ` · ${result.season}` : ""}`}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Tabs
                tabs={["Players", "Coaches"]}
                active={tab}
                onChange={setTab}
                style={{ flex: "1 1 auto", minWidth: 200 }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexShrink: 0,
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <Combobox
                  label="Format"
                  width={100}
                  value={exportFormat}
                  options={[
                    { value: "json", label: "JSON" },
                    { value: "csv", label: "CSV" },
                  ]}
                  onChange={(v) => setExportFormat(v as ExportFormat)}
                />
                <Button label="Copy" size="sm" onClick={copyExport} />
                <Button
                  label="Download"
                  size="sm"
                  variant="accent"
                  onClick={downloadExport}
                />
                <Combobox
                  label="Images"
                  width={150}
                  value={imageNaming}
                  options={[
                    { value: "named", label: "jersey_name" },
                    { value: "numbered", label: "1.jpg" },
                  ]}
                  onChange={(v) => setImageNaming(v as ImageNaming)}
                />
                <Checkbox
                  checked={removeBg}
                  onChange={setRemoveBg}
                  label="Remove BG"
                  disabled={zipping}
                  style={{ marginBottom: 4 }}
                />
                <Button
                  label={zipping ? (removeBg ? "Processing…" : "Zipping…") : "Images ZIP"}
                  size="sm"
                  disabled={zipping}
                  onClick={downloadHeadshotsZip}
                />
              </div>
            </div>
            <div style={{ marginTop: 12, ...ROSTER_GRID_STYLE }}>
              {tab === 0 ? (
                <DataGrid
                  height={480}
                  columns={[
                    { key: "jersey", label: "#", width: "40px", dim: true },
                    { key: "name", label: "Name", width: "minmax(120px,1fr)" },
                    { key: "position", label: "Pos", width: "56px" },
                    { key: "year", label: "Yr", width: "48px", dim: true },
                    { key: "hometown", label: "Hometown", width: "minmax(100px,1fr)", dim: true },
                    { key: "highSchool", label: "High School", width: "minmax(100px,1fr)", dim: true },
                    {
                      key: "headshot",
                      label: "Photo",
                      width: "72px",
                      render: (v) => <HeadshotThumb url={v} />,
                    },
                    {
                      key: "bio",
                      label: "Bio",
                      width: "48px",
                      render: (v) =>
                        v ? (
                          <a
                            href={String(v)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--info)" }}
                          >
                            ↗
                          </a>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                  rows={playerRows}
                />
              ) : (
                <DataGrid
                  height={320}
                  columns={[
                    { key: "name", label: "Name", width: "minmax(140px,1fr)" },
                    { key: "title", label: "Title", width: "minmax(200px,2fr)", dim: true },
                    {
                      key: "headshot",
                      label: "Photo",
                      width: "72px",
                      render: (v) => <HeadshotThumb url={v} />,
                    },
                    {
                      key: "bio",
                      label: "Bio",
                      width: "48px",
                      render: (v) =>
                        v ? (
                          <a
                            href={String(v)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--info)" }}
                          >
                            ↗
                          </a>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                  rows={coachRows}
                />
              )}
            </div>
          </Panel>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
