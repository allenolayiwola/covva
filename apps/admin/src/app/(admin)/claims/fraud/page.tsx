import { Suspense } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Notice, PageHeader, Pill, StatusPill } from "@im/ui";
import { CLAIM_STATUS, FRAUD_KIND_LABELS, FRAUD_STATUS_LABELS, type FraudKind, type FraudStatus } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { rerunFraudChecks, reviewFraudFlag } from "./actions";

export default function FraudQueuePage({ searchParams }: PageProps<"/claims/fraud">) {
  return (
    <>
      <PageHeader title="Claim fraud review" description="Claims the automated checks have flagged: duplicates, identity mismatches, inactive policies, late reports, repeat claimants and reused documents." />
      <Notice tone="info" icon={<ShieldAlert className="size-4" />} title="Indicators, not verdicts" className="mb-5">
        A flag means the insurer&apos;s claims team should look closer. Clearing a flag records why; confirming marks the claim as confirmed fraud for the insurer. Flags are never shown to customers or brokers, and platform staff still cannot approve, decline or pay a claim.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading flagged claims…" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const status = sp(params, "status") ?? "open";
  const canAct = can(staff.roles, "conduct");

  let flagsQuery = supabase.from("claim_fraud_flags").select("*").order("created_at", { ascending: false }).limit(300);
  if (status === "open") flagsQuery = flagsQuery.eq("status", "open");
  else if (status === "confirmed") flagsQuery = flagsQuery.eq("status", "confirmed");
  else if (status === "cleared") flagsQuery = flagsQuery.eq("status", "cleared");
  const { data: flags, error } = await flagsQuery;
  const claimIds = [...new Set((flags ?? []).map((f) => f.claim_id))];
  const { data: claims } = claimIds.length
    ? await supabase.from("claims").select("id, reference, status, customer_id, insurer_org_id, broker_org_id, amount_claimed, incident_at, reported_at, fraud_score, fraud_status").in("id", claimIds)
    : { data: [] };
  const byClaim = new Map((claims ?? []).map((c) => [c.id, c]));
  const [orgs, people] = await Promise.all([orgMap(supabase), profileMap(supabase, (claims ?? []).map((c) => c.customer_id))]);
  const grouped = claimIds.map((id) => ({ claim: byClaim.get(id), flags: (flags ?? []).filter((f) => f.claim_id === id) })).filter((g) => g.claim);

  return (
    <>
      <FilterBar action="/claims/fraud">
        <FilterSelect name="status" label="Flags" value={status} options={[{ value: "open", label: "Open" }, { value: "confirmed", label: "Confirmed" }, { value: "cleared", label: "Cleared" }, { value: "all", label: "All" }]} />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      {grouped.length === 0 && <p className="rounded-card border border-line bg-white px-5 py-10 text-center text-sm text-muted">No flagged claims.</p>}
      <div className="space-y-4">
        {grouped.map(({ claim, flags: list }) => {
          const c = claim!;
          const fs = (c.fraud_status ?? "clear") as FraudStatus;
          return (
            <section key={c.id} className="rounded-card border border-line bg-white p-5" aria-labelledby={`fraud-${c.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id={`fraud-${c.id}`} className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                    <Link href={`/claims/${c.id}`} className="hover:text-brand">{c.reference}</Link>
                    <StatusPill meta={CLAIM_STATUS[c.status]} />
                    <Pill tone={FRAUD_STATUS_LABELS[fs]?.tone ?? "neutral"}>{FRAUD_STATUS_LABELS[fs]?.label ?? fs} · {c.fraud_score != null ? Number(c.fraud_score) : 0}/100</Pill>
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {personName(people.get(c.customer_id))} · {orgs.get(c.insurer_org_id)?.name}{c.broker_org_id ? ` · ${orgs.get(c.broker_org_id)?.name}` : ""} · claimed {formatGHS(c.amount_claimed == null ? null : Number(c.amount_claimed))} · incident {formatDateTime(c.incident_at)} · reported {formatDateTime(c.reported_at)}
                  </p>
                </div>
                {canAct && (
                  <ActionForm action={rerunFraudChecks} submitLabel="Re-run checks" submitVariant="outline" inline audited={false}>
                    <input type="hidden" name="claimId" value={c.id} />
                  </ActionForm>
                )}
              </div>
              <ul className="mt-3 divide-y divide-line">
                {list.map((f) => {
                  const meta = FRAUD_KIND_LABELS[f.kind as FraudKind];
                  const details = (f.details ?? {}) as Record<string, unknown>;
                  return (
                    <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium text-ink">
                          {meta?.label ?? f.kind}
                          <Pill tone={f.status === "cleared" ? "neutral" : f.status === "confirmed" ? "danger" : "wait"}>{f.status}</Pill>
                        </p>
                        <p className="text-xs text-muted">{meta?.hint}</p>
                        <p className="mt-1 text-xs text-ink-2">{Object.entries(details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</p>
                        {f.reviewed_at && <p className="mt-1 text-xs text-muted">Reviewed {formatDateTime(f.reviewed_at)}{f.review_note ? ` — ${f.review_note}` : ""}</p>}
                      </div>
                      {canAct && f.status === "open" && (
                        <div className="flex flex-wrap gap-2">
                          <ConfirmAction action={reviewFraudFlag} fields={{ flagId: f.id, status: "cleared" }} label="Clear" title="Clear this indicator" body="Record why this indicator does not point to fraud." confirmLabel="Clear flag" variant="secondary" />
                          <ConfirmAction action={reviewFraudFlag} fields={{ flagId: f.id, status: "confirmed" }} label="Confirm" title="Confirm fraud" body="The claim is marked as confirmed fraud for the insurer's claims team." confirmLabel="Confirm fraud" confirmWord="CONFIRM" />
                        </div>
                      )}
                      {canAct && f.status !== "open" && (
                        <ConfirmAction action={reviewFraudFlag} fields={{ flagId: f.id, status: "open" }} label="Reopen" title="Reopen this indicator" confirmLabel="Reopen" variant="secondary" requireReason={false} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
