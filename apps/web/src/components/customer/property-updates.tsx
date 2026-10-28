import { Camera, ClipboardCheck } from "lucide-react";
import { formatDate, formatDateTime, propertyProgress, propertyTimeline } from "@im/core";
import { Card, Pill } from "@im/ui";
import { INSPECTION_STATUS } from "@/server/property";
import { UploadDropzone } from "@/components/customer/upload";
import { signUrls, type Supabase } from "@/app/(site)/(customer)/account/_lib/data";
import { addPropertyPhoto, requestPropertyInspection } from "@/app/(site)/(customer)/account/policies/[id]/property-actions";
import { InspectionRequestForm } from "./property-inspection-form";

/**
 * "Property updates" on a home / property policy (diaspora property cover): one photo timeline that merges the
 * family's uploads from the site with the inspection partner's scheduled visits, reports and photos, so the
 * sponsor abroad follows the build from anywhere. Reads go through the caller's RLS client (policy customer,
 * sponsor, broker, insurer); photos live in the private documents bucket and are signed for an hour.
 */
export async function PropertyUpdatesCard({ policyId, userId, supabase }: { policyId: string; userId: string; supabase: Supabase }) {
  const [{ data: updates }, { data: inspections }] = await Promise.all([
    supabase.from("property_updates").select("id, storage_path, caption, taken_at, created_at, uploaded_by").eq("policy_id", policyId).order("created_at", { ascending: false }).limit(60),
    supabase.from("property_inspections").select("id, status, address, scheduled_for, completed_at, report, photos, created_at, partner:organizations!property_inspections_partner_org_id_fkey(name)").eq("policy_id", policyId).order("created_at", { ascending: false }).limit(10),
  ]);
  const inspectionRows = (inspections ?? []).map((i) => ({ ...i, partner_name: (i.partner as unknown as { name: string } | null)?.name ?? null }));
  const timeline = propertyTimeline(updates ?? [], inspectionRows);
  const progress = propertyProgress(timeline);
  const urls = await signUrls(supabase, timeline.flatMap((e) => e.photos.map((p) => p.storage_path)));
  const open = inspectionRows.find((i) => ["requested", "assigned", "scheduled"].includes(i.status));
  const toneClass: Record<string, string> = { ok: "bg-mint text-brand-deep", danger: "bg-danger-bg text-danger", info: "bg-mist text-ink-2", wait: "bg-amber-bg text-amber", neutral: "bg-mist text-ink-2" };

  return (
    <section aria-labelledby="property-h">
      <h2 id="property-h" className="text-lg font-semibold text-ink">Property updates</h2>
      <p className="mt-1 text-sm text-muted">Photos from the site as the building progresses, plus partner inspections. The insurer decides what a report means for your cover.</p>
      <Card className="mt-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><Camera aria-hidden className="size-5" /></span>
            <div>
              <p className="font-semibold text-ink">Build timeline</p>
              <p className="text-xs text-muted">{progress.label}{progress.lastUpdateAt ? ` · last update ${formatDate(progress.lastUpdateAt)}` : ""}</p>
            </div>
          </div>
          {open && <Pill tone={INSPECTION_STATUS[open.status]?.tone ?? "wait"}>{INSPECTION_STATUS[open.status]?.label ?? open.status}</Pill>}
        </div>
        {timeline.length > 0 && (
          <ol className="mt-5 space-y-5 border-l border-line pl-4">
            {timeline.map((e) => (
              <li key={e.key} className="relative">
                <span aria-hidden className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${e.tone === "ok" ? "bg-brand" : e.tone === "danger" ? "bg-danger" : "bg-line"}`} />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-ink">{e.title}</p>
                  <p className="text-xs text-muted">{e.kind === "inspection_scheduled" ? formatDateTime(e.at) : formatDate(e.at)} · {e.source === "family" ? "from the family" : e.source === "partner" ? "inspection partner" : "Covva"}</p>
                </div>
                {e.body && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{e.body}</p>}
                {e.photos.length > 0 && (
                  <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {e.photos.map((p) => (
                      <li key={p.storage_path} className="overflow-hidden rounded-lg border border-line bg-mist">
                        {urls[p.storage_path] ? (
                          <a href={urls[p.storage_path]} target="_blank" rel="noopener noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={urls[p.storage_path]} alt={p.caption ?? e.title} className="aspect-square w-full object-cover" loading="lazy" />
                          </a>
                        ) : (
                          <span className="grid aspect-square place-items-center px-1 text-center text-[11px] text-muted">Photo not available</span>
                        )}
                        {p.caption && <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{p.caption}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {e.kind === "inspection_report" && <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClass[e.tone]}`}>Shared with the insurer</span>}
              </li>
            ))}
          </ol>
        )}
        <UploadDropzone className="mt-4" userId={userId} scope="policies" title="Add a photo from the site" buttonLabel="Upload photo" compact action={addPropertyPhoto.bind(null, policyId)} />
      </Card>
      <Card className="mt-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><ClipboardCheck aria-hidden className="size-5" /></span>
            <div>
              <p className="font-semibold text-ink">Site inspection</p>
              <p className="text-xs text-muted">A partner visits the property, files a report with photos and the insurer decides what it means for cover.</p>
            </div>
          </div>
        </div>
        {inspectionRows.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
            {inspectionRows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{i.address ?? "Property"}{i.partner_name ? <span className="font-normal text-muted"> · {i.partner_name}</span> : null}</p>
                  <p className="text-xs text-muted">
                    Requested {formatDate(i.created_at)}
                    {i.scheduled_for ? ` · visit ${formatDateTime(i.scheduled_for)}` : ""}
                    {i.completed_at ? ` · completed ${formatDate(i.completed_at)}` : ""}
                  </p>
                </div>
                <Pill tone={INSPECTION_STATUS[i.status]?.tone ?? "neutral"}>{INSPECTION_STATUS[i.status]?.label ?? i.status}</Pill>
              </li>
            ))}
          </ul>
        )}
        {!open && <InspectionRequestForm action={requestPropertyInspection.bind(null, policyId)} />}
      </Card>
    </section>
  );
}
