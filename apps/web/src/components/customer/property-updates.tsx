import { Camera, ClipboardCheck } from "lucide-react";
import { formatDate, formatDateTime } from "@im/core";
import { Card, Pill } from "@im/ui";
import { INSPECTION_STATUS } from "@/server/property";
import { UploadDropzone } from "@/components/customer/upload";
import { signUrls, type Supabase } from "@/app/(customer)/account/_lib/data";
import { addPropertyPhoto, requestPropertyInspection } from "@/app/(customer)/account/policies/[id]/property-actions";
import { InspectionRequestForm } from "./property-inspection-form";

/**
 * "Property updates" on a home / property policy (diaspora property cover): photo updates from the
 * site during construction and partner inspections. Reads go through the caller's RLS client
 * (policy customer, sponsor, broker, insurer).
 */
export async function PropertyUpdatesCard({ policyId, userId, supabase }: { policyId: string; userId: string; supabase: Supabase }) {
  const [{ data: updates }, { data: inspections }] = await Promise.all([
    supabase.from("property_updates").select("id, storage_path, caption, taken_at, created_at, uploaded_by").eq("policy_id", policyId).order("created_at", { ascending: false }).limit(24),
    supabase.from("property_inspections").select("id, status, address, scheduled_for, completed_at, report, created_at").eq("policy_id", policyId).order("created_at", { ascending: false }).limit(5),
  ]);
  const photos = updates ?? [];
  const urls = await signUrls(supabase, photos.map((p) => p.storage_path));
  const open = (inspections ?? []).find((i) => ["requested", "assigned", "scheduled"].includes(i.status));
  return (
    <section aria-labelledby="property-h">
      <h2 id="property-h" className="text-lg font-semibold text-ink">Property updates</h2>
      <p className="mt-1 text-sm text-muted">Share photos from the site as the building progresses, and ask for a partner inspection. The insurer decides what a report means for your cover.</p>
      <Card className="mt-3 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><Camera aria-hidden className="size-5" /></span>
          <div>
            <p className="font-semibold text-ink">Photo updates</p>
            <p className="text-xs text-muted">{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · latest ${formatDate(photos[0]!.created_at)}` : "No photos yet"}</p>
          </div>
        </div>
        {photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-lg border border-line bg-mist">
                {urls[p.storage_path] ? (
                  <a href={urls[p.storage_path]} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urls[p.storage_path]} alt={p.caption ?? "Site photo"} className="aspect-square w-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <span className="block aspect-square" />
                )}
                <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{formatDate(p.taken_at ?? p.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <UploadDropzone className="mt-4" userId={userId} scope="policies" title="Add a photo from the site" buttonLabel="Upload photo" compact action={addPropertyPhoto.bind(null, policyId)} />
      </Card>
      <Card className="mt-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><ClipboardCheck aria-hidden className="size-5" /></span>
            <div>
              <p className="font-semibold text-ink">Site inspection</p>
              <p className="text-xs text-muted">A partner visits the property and reports to the insurer.</p>
            </div>
          </div>
          {open && <Pill tone={INSPECTION_STATUS[open.status]?.tone ?? "wait"}>{INSPECTION_STATUS[open.status]?.label ?? open.status}</Pill>}
        </div>
        {(inspections ?? []).length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
            {(inspections ?? []).map((i) => {
              const report = (i.report ?? {}) as { summary?: string; condition?: string };
              return (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{i.address ?? "Property"}</p>
                    <p className="text-xs text-muted">
                      Requested {formatDate(i.created_at)}
                      {i.scheduled_for ? ` · visit ${formatDateTime(i.scheduled_for)}` : ""}
                      {i.completed_at ? ` · completed ${formatDate(i.completed_at)}` : ""}
                    </p>
                    {report.summary && <p className="mt-1 text-sm text-ink-2">{report.summary}{report.condition ? ` (${report.condition})` : ""}</p>}
                  </div>
                  <Pill tone={INSPECTION_STATUS[i.status]?.tone ?? "neutral"}>{INSPECTION_STATUS[i.status]?.label ?? i.status}</Pill>
                </li>
              );
            })}
          </ul>
        )}
        {!open && <InspectionRequestForm action={requestPropertyInspection.bind(null, policyId)} />}
      </Card>
    </section>
  );
}
