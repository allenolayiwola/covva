import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { formatDate, formatDateTime } from "@im/core";
import { Card, EmptyState, Field, Input, PageHeader, Pill, Select, Tabs, Textarea } from "@im/ui";
import { getPartnerContext } from "../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/partner/ui";
import { MultiUpload } from "@/components/customer/upload";
import { INSPECTION_STATUS } from "@/server/property";
import { completeAssignedInspection, scheduleAssignedInspection } from "./actions";

export const metadata: Metadata = { title: "Property inspections" };

const VIEWS = [
  { key: "open", label: "To do", statuses: ["assigned", "scheduled"] },
  { key: "done", label: "Completed", statuses: ["completed", "failed"] },
] as const;

export default function InspectionsPage({ searchParams }: PageProps<"/partner/inspections">) {
  return (
    <>
      <PageHeader title="Property inspections" description="Site visits assigned to your organisation by Covva. Accept and schedule, then file the report with photos. The insurer decides what the report means for cover." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Inspections searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inspections({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  // Only organisations flagged as inspection partners (organizations.settings.inspection_partner = true).
  if ((ctx.membership.org.settings as { inspection_partner?: boolean } | null)?.inspection_partner !== true) redirect("/partner");
  const sp = await searchParams;
  const key = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "open";
  const view = VIEWS.find((v) => v.key === key) ?? VIEWS[0];
  const { data } = await ctx.supabase.from("property_inspections").select("*").eq("partner_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(500);
  const all = data ?? [];
  const rows = all.filter((i) => (view.statuses as readonly string[]).includes(i.status));
  return (
    <>
      <Tabs active={view.key} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: `/partner/inspections?view=${v.key}`, count: all.filter((i) => (v.statuses as readonly string[]).includes(i.status)).length }))} />
      <div className="mt-4 space-y-4">
        {rows.length === 0 && <EmptyState title={view.key === "open" ? "No inspections to do" : "No completed inspections"} body="Covva assigns inspections to your organisation from the admin console; you are notified by email." />}
        {rows.map((i) => {
          const meta = INSPECTION_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
          const report = (i.report ?? {}) as { summary?: string; condition?: string; stage?: string };
          const photos = (Array.isArray(i.photos) ? i.photos : []) as { storage_path: string; caption?: string | null }[];
          return (
            <Card key={i.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{i.address ?? "Address not given"}</p>
                  <p className="text-xs text-muted">
                    Requested {formatDate(i.created_at)}
                    {i.policy_id ? ` · policy ${i.policy_id.slice(0, 8)}` : i.request_id ? ` · request ${i.request_id.slice(0, 8)}` : ""}
                    {i.scheduled_for ? ` · visit ${formatDateTime(i.scheduled_for)}` : ""}
                    {i.completed_at ? ` · completed ${formatDate(i.completed_at)}` : ""}
                  </p>
                  {i.notes && <p className="mt-2 text-sm text-ink-2">{i.notes}</p>}
                  {i.gps && <p className="mt-1 text-xs text-subtle">GPS {JSON.stringify(i.gps)}</p>}
                </div>
                <Pill tone={meta.tone}>{meta.label}</Pill>
              </div>
              {(i.status === "assigned" || i.status === "scheduled") && (
                <div className="mt-4 grid gap-6 lg:grid-cols-2">
                  <ActionForm action={scheduleAssignedInspection} submitLabel={i.status === "assigned" ? "Accept and schedule" : "Reschedule"} pendingLabel="Saving…" variant="secondary">
                    <input type="hidden" name="inspectionId" value={i.id} />
                    <Field label="Visit date and time" htmlFor={`sched-${i.id}`}>
                      <Input id={`sched-${i.id}`} name="scheduledFor" type="datetime-local" required defaultValue={i.scheduled_for ? i.scheduled_for.slice(0, 16) : ""} />
                    </Field>
                  </ActionForm>
                  <ActionForm action={completeAssignedInspection} submitLabel="File report" pendingLabel="Filing…">
                    <input type="hidden" name="inspectionId" value={i.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Outcome" htmlFor={`out-${i.id}`}>
                        <Select id={`out-${i.id}`} name="outcome" defaultValue="completed">
                          <option value="completed">Inspected</option>
                          <option value="failed">Could not inspect</option>
                        </Select>
                      </Field>
                      <Field label="Condition" htmlFor={`cond-${i.id}`}>
                        <Select id={`cond-${i.id}`} name="condition" defaultValue="under_construction">
                          <option value="under_construction">Under construction</option>
                          <option value="good">Good</option>
                          <option value="fair">Fair</option>
                          <option value="poor">Poor</option>
                          <option value="not_found">Property not found</option>
                        </Select>
                      </Field>
                    </div>
                    <Field label="Stage of works (optional)" htmlFor={`stage-${i.id}`}><Input id={`stage-${i.id}`} name="stage" maxLength={120} placeholder="e.g. roofing complete, plastering in progress" /></Field>
                    <Field label="Summary for the insurer" htmlFor={`sum-${i.id}`}><Textarea id={`sum-${i.id}`} name="summary" rows={3} required minLength={10} maxLength={4000} /></Field>
                    <Field label="Risks observed (optional)" htmlFor={`risk-${i.id}`}><Textarea id={`risk-${i.id}`} name="risks" rows={2} maxLength={4000} placeholder="Flood exposure, unsecured materials, wiring…" /></Field>
                    <MultiUpload userId={ctx.userId} scope="policies" name="photos" label="Site photos" hint="JPG or PNG · up to 10 MB each" max={12} accept="image/jpeg,image/png,image/webp,image/heic" tiles />
                  </ActionForm>
                </div>
              )}
              {(i.status === "completed" || i.status === "failed") && (
                <div className="mt-3 text-sm text-ink-2">
                  {report.summary && <p>{report.summary}</p>}
                  <p className="mt-1 text-xs text-muted">{[report.condition ? `Condition: ${report.condition.replace(/_/g, " ")}` : null, report.stage ? `Stage: ${report.stage}` : null, `${photos.length} photo${photos.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
