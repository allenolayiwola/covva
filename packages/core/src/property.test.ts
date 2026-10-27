import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyProgress, propertyTimeline } from "./property.ts";

const UPDATES = [
  { id: "u1", storage_path: "s/policies/a.jpg", caption: "Foundation poured", taken_at: "2026-09-01T10:00:00Z", created_at: "2026-09-01T11:00:00Z" },
  { id: "u2", storage_path: "s/policies/b.jpg", caption: null, taken_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:30:00Z" },
  { id: "u3", storage_path: "s/policies/c.jpg", caption: "Roofing", taken_at: null, created_at: "2026-10-20T09:00:00Z" },
];
const INSPECTIONS = [
  {
    id: "i1",
    status: "completed",
    address: "Plot 12, Oyarifa",
    scheduled_for: "2026-10-05T09:00:00Z",
    completed_at: "2026-10-05T14:00:00Z",
    created_at: "2026-09-28T08:00:00Z",
    report: { summary: "Walls up to lintel level.", condition: "under_construction", stage: "lintel level" },
    photos: [{ storage_path: "p/policies/insp1.jpg", caption: "Front", taken_at: "2026-10-05T13:00:00Z" }, { nope: true }, { storage_path: "" }],
    partner_name: "Accra Surveys",
  },
  { id: "i2", status: "failed", address: "Plot 12, Oyarifa", scheduled_for: null, completed_at: "2026-10-25T10:00:00Z", created_at: "2026-10-22T08:00:00Z", report: {}, photos: [] },
];

test("propertyTimeline merges day-grouped family photos with inspection events, newest first", () => {
  const t = propertyTimeline(UPDATES, INSPECTIONS);
  assert.deepEqual(t.map((e) => e.kind), ["inspection_failed", "inspection_requested", "photo", "inspection_report", "inspection_scheduled", "inspection_requested", "photo"]);
  const sept = t.find((e) => e.key === "photos:2026-09-01")!;
  assert.equal(sept.title, "2 photos from the site");
  assert.equal(sept.body, "Foundation poured");
  assert.equal(sept.photos.length, 2);
  assert.equal(sept.source, "family");
  const report = t.find((e) => e.kind === "inspection_report")!;
  assert.equal(report.photos.length, 1, "malformed photo entries are dropped");
  assert.match(report.body ?? "", /Walls up to lintel level/);
  assert.match(report.body ?? "", /Condition: under construction/);
  assert.equal(report.source, "partner");
  assert.equal(report.tone, "ok");
  const scheduled = t.find((e) => e.kind === "inspection_scheduled")!;
  assert.match(scheduled.body ?? "", /Accra Surveys/);
  const failed = t.find((e) => e.kind === "inspection_failed")!;
  assert.match(failed.body ?? "", /could not inspect/);
  assert.equal(failed.photos.length, 0);
});

test("propertyProgress reports the latest stage of works, else the photo count", () => {
  const t = propertyTimeline(UPDATES, INSPECTIONS);
  const p = propertyProgress(t);
  assert.equal(p.label, "lintel level");
  assert.equal(p.photos, 4);
  assert.equal(p.lastUpdateAt, "2026-10-25T10:00:00Z");
  assert.equal(propertyProgress(propertyTimeline(UPDATES, [])).label, "3 photos so far");
  assert.deepEqual(propertyProgress([]), { label: "No updates yet", photos: 0, lastUpdateAt: null });
});
