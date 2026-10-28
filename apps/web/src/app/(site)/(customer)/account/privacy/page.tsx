import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, ShieldCheck } from "lucide-react";
import {
  DELETION_RETAINED,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS,
  OPEN_PRIVACY_STATUSES,
  canWithdrawPrivacy,
  describeRetainedRecords,
  formatDate,
  formatDateTime,
  normalisePrivacyDueDays,
  privacyDeadline,
  type PrivacyRequestType,
} from "@im/core";
import { Card, EmptyState, Notice, PageHeader, StatusPill, buttonClass } from "@im/ui";
import { getSetting } from "@/lib/catalog";
import { ListSkeleton } from "@/components/customer/skeletons";
import { account } from "../_lib/data";
import { PrivacyRequestForm, WithdrawButton } from "./forms";

export const metadata: Metadata = { title: "Privacy & your data" };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        title="Privacy & your data"
        description="Ask for a copy of your data, get something corrected, stop marketing, object to how we use your data, or close your account."
      />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const { user, supabase } = await account("/account/privacy");
  const [{ data: requests }, { data: events }, dueSetting] = await Promise.all([
    supabase
      .from("privacy_requests")
      .select("id, reference, type, status, note, due_at, created_at, decision_reason, fulfilment_note, retention_note, anonymisation_summary, export_path, export_expires_at, export_downloaded_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("privacy_request_events").select("id, request_id, note, to_status, event, created_at").order("created_at", { ascending: true }).limit(500),
    getSetting<unknown>("privacy_request_due_days"),
  ]);
  const list = requests ?? [];
  const dueDays = normalisePrivacyDueDays(dueSetting);
  const openTypes = list.filter((r) => OPEN_PRIVACY_STATUSES.includes(r.status)).map((r) => r.type as PrivacyRequestType);
  const byRequest = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) byRequest.set(e.request_id, [...(byRequest.get(e.request_id) ?? []), e]);
  const now = new Date();

  return (
    <div className="space-y-10" data-testid="privacy-page">
      <section aria-labelledby="privacy-new">
        <h2 id="privacy-new" className="mb-1 text-lg font-semibold text-ink">Make a request</h2>
        <p className="mb-5 text-sm text-muted">
          It&apos;s free. We check it&apos;s really you before we share or change anything, and we reply within {dueDays} days. Stopping marketing happens straight away.
        </p>
        <Card className="p-5">
          <PrivacyRequestForm openTypes={openTypes} dueDays={dueDays} />
        </Card>
      </section>

      <section aria-labelledby="privacy-history">
        <h2 id="privacy-history" className="mb-4 text-lg font-semibold text-ink">Your requests</h2>
        {list.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-6" aria-hidden />} title="No requests yet" body="Requests you make appear here with their progress." />
        ) : (
          <ul className="space-y-4">
            {list.map((r) => {
              const meta = PRIVACY_REQUEST_TYPES[r.type];
              const status = PRIVACY_STATUS[r.status];
              const deadline = privacyDeadline(r, now);
              const expired = r.export_expires_at ? Date.parse(r.export_expires_at) < now.getTime() : false;
              const kept = describeRetainedRecords((r.anonymisation_summary as { retained?: Record<string, unknown> } | null)?.retained);
              const steps = byRequest.get(r.id) ?? [];
              return (
                <li key={r.id}>
                  <Card as="article" className="space-y-3 p-5" aria-labelledby={`req-${r.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 id={`req-${r.id}`} className="text-[15px] font-semibold text-ink">{meta.customerLabel}</h3>
                        <p className="text-[13px] text-muted">
                          {r.reference} · sent {formatDate(r.created_at)}
                          {deadline.daysLeft !== null && ` · we'll reply by ${formatDate(r.due_at)}`}
                        </p>
                      </div>
                      <StatusPill meta={status} />
                    </div>
                    {status.customerHint && <p className="text-sm text-ink-2">{status.customerHint}</p>}
                    {r.note && <p className="text-sm text-muted">Your note: &ldquo;{r.note}&rdquo;</p>}

                    {r.status === "export_ready" && r.export_path && !expired && (
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Authenticated route: checks it's you, counts the download and streams the file. No public link. */}
                        <a href={`/account/privacy/${r.id}/download`} className={buttonClass("primary", "md", "min-h-11")} download>
                          <Download aria-hidden className="size-4" /> Download my data (JSON)
                        </a>
                        <p className="text-[13px] text-muted">
                          Available until {formatDateTime(r.export_expires_at)}
                          {r.export_downloaded_at ? ` · last downloaded ${formatDateTime(r.export_downloaded_at)}` : ""}
                        </p>
                      </div>
                    )}
                    {r.status === "refused" && r.decision_reason && (
                      <Notice tone="danger" title="Why we couldn't do this">{r.decision_reason}</Notice>
                    )}
                    {r.status === "fulfilled" || r.status === "closed" ? (
                      r.fulfilment_note && r.type !== "deletion" ? <Notice tone="ok">{r.fulfilment_note}</Notice> : null
                    ) : null}
                    {r.type === "deletion" && r.retention_note && (
                      <Notice tone="ok" title="What we erased and what we kept">
                        <p>{r.retention_note}</p>
                        {kept.length > 0 && <p className="mt-1">Kept: {kept.join(", ")}.</p>}
                      </Notice>
                    )}

                    {steps.length > 0 && (
                      <details className="text-sm">
                        <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-brand">Progress ({steps.length})</summary>
                        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
                          {steps.map((e) => (
                            <li key={e.id} className="text-ink-2">
                              <span className="text-[13px] text-muted">{formatDateTime(e.created_at)}</span>
                              <span className="block">{e.note ?? (e.to_status ? PRIVACY_STATUS[e.to_status].label : "Update")}</span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {canWithdrawPrivacy(r.status) && <WithdrawButton id={r.id} />}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="privacy-kept">
        <h2 id="privacy-kept" className="mb-1 text-lg font-semibold text-ink">What we have to keep</h2>
        <p className="mb-4 text-sm text-muted">
          Covva is a technology platform. If you close your account we erase everything we don&apos;t need, but some records must be kept by law. The insurers and brokers who
          arranged or issued your cover keep their own records too — ask them directly for those.
        </p>
        <ul className="divide-y divide-line rounded-card border border-line">
          {DELETION_RETAINED.filter((e) => e.label).map((e) => (
            <li key={e.table} className="px-4 py-3 text-sm">
              <p className="font-medium text-ink">{e.label}</p>
              <p className="text-muted">{e.reason}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
