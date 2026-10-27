/**
 * Diaspora property cover (Roadmap Phase 4): the sponsor abroad follows the home being built in Ghana through
 * photo updates from the family on site and the reports / photos of partner inspections. This module merges the
 * two into one timeline; storage paths are signed by the app (private bucket) before display.
 */
export interface PropertyUpdateLike {
  id: string;
  storage_path: string;
  caption?: string | null;
  taken_at?: string | null;
  created_at: string;
  uploaded_by?: string | null;
}

export interface InspectionLike {
  id: string;
  status: string;
  address?: string | null;
  scheduled_for?: string | null;
  completed_at?: string | null;
  created_at: string;
  report?: unknown;
  photos?: unknown;
  partner_name?: string | null;
}

export type TimelineEntryKind = "photo" | "inspection_requested" | "inspection_scheduled" | "inspection_report" | "inspection_failed";

export interface PropertyTimelineEntry {
  key: string;
  kind: TimelineEntryKind;
  /** ISO timestamp the entry is ordered by. */
  at: string;
  title: string;
  body: string | null;
  /** Photos attached to this entry (storage paths, to be signed). */
  photos: { storage_path: string; caption: string | null; taken_at: string | null }[];
  /** Who it came from. */
  source: "family" | "partner" | "covva";
  inspectionId?: string;
  tone: "neutral" | "info" | "ok" | "danger" | "wait";
}

function asPhotos(raw: unknown): PropertyTimelineEntry["photos"] {
  if (!Array.isArray(raw)) return [];
  const out: PropertyTimelineEntry["photos"] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.storage_path !== "string" || !o.storage_path) continue;
    out.push({ storage_path: o.storage_path, caption: typeof o.caption === "string" ? o.caption : null, taken_at: typeof o.taken_at === "string" ? o.taken_at : null });
  }
  return out;
}

function reportOf(raw: unknown): { summary?: string; condition?: string; stage?: string; risks?: string } {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

const pretty = (s: string | undefined) => (s ? s.replace(/_/g, " ") : "");

/** Newest first. Photo updates group by day so a batch of uploads reads as one entry. */
export function propertyTimeline(updates: PropertyUpdateLike[], inspections: InspectionLike[]): PropertyTimelineEntry[] {
  const entries: PropertyTimelineEntry[] = [];
  const byDay = new Map<string, PropertyUpdateLike[]>();
  for (const u of updates) {
    const at = (u.taken_at ?? u.created_at).slice(0, 10);
    byDay.set(at, [...(byDay.get(at) ?? []), u]);
  }
  for (const [dayKey, rows] of byDay) {
    const sorted = [...rows].sort((a, b) => (a.taken_at ?? a.created_at).localeCompare(b.taken_at ?? b.created_at));
    const captions = sorted.map((r) => r.caption?.trim()).filter((c): c is string => !!c);
    const last = sorted[sorted.length - 1]!;
    entries.push({
      key: `photos:${dayKey}`,
      kind: "photo",
      at: last.taken_at ?? last.created_at,
      title: `${sorted.length} photo${sorted.length === 1 ? "" : "s"} from the site`,
      body: captions.length ? captions.slice(0, 3).join(" · ") : null,
      photos: sorted.map((r) => ({ storage_path: r.storage_path, caption: r.caption ?? null, taken_at: r.taken_at ?? null })),
      source: "family",
      tone: "neutral",
    });
  }
  for (const i of inspections) {
    const who = i.partner_name ? `${i.partner_name} (inspection partner)` : "The inspection partner";
    entries.push({ key: `insp:${i.id}:requested`, kind: "inspection_requested", at: i.created_at, title: "Site inspection requested", body: i.address ?? null, photos: [], source: "covva", inspectionId: i.id, tone: "wait" });
    if (i.scheduled_for) {
      entries.push({ key: `insp:${i.id}:scheduled`, kind: "inspection_scheduled", at: i.scheduled_for, title: "Site visit scheduled", body: `${who} visits the property.`, photos: [], source: "partner", inspectionId: i.id, tone: "info" });
    }
    if (i.status === "completed" || i.status === "failed") {
      const r = reportOf(i.report);
      const bits = [r.condition ? `Condition: ${pretty(r.condition)}` : null, r.stage ? `Stage: ${r.stage}` : null].filter(Boolean).join(" · ");
      entries.push({
        key: `insp:${i.id}:${i.status}`,
        kind: i.status === "completed" ? "inspection_report" : "inspection_failed",
        at: i.completed_at ?? i.created_at,
        title: i.status === "completed" ? "Inspection report filed" : "Inspection could not be done",
        body: [r.summary, bits].filter(Boolean).join("\n") || (i.status === "failed" ? "The partner could not inspect the property; your broker will be in touch." : null),
        photos: i.status === "completed" ? asPhotos(i.photos) : [],
        source: "partner",
        inspectionId: i.id,
        tone: i.status === "completed" ? "ok" : "danger",
      });
    }
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

/** Stage-of-works progress for the header: the latest inspection's stage, or the photo count. */
export function propertyProgress(timeline: PropertyTimelineEntry[]): { label: string; photos: number; lastUpdateAt: string | null } {
  const photos = timeline.reduce((n, e) => n + e.photos.length, 0);
  const lastReport = timeline.find((e) => e.kind === "inspection_report");
  const stage = lastReport?.body?.split("\n").flatMap((l) => l.split(" · ")).find((l) => l.startsWith("Stage:"))?.slice(6).trim();
  return { label: stage ? stage : photos ? `${photos} photo${photos === 1 ? "" : "s"} so far` : "No updates yet", photos, lastUpdateAt: timeline[0]?.at ?? null };
}
