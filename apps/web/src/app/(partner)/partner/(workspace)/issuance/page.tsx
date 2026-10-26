import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, EmptyState, Field, Input, Notice, PageHeader, Pill, StatusPill, Textarea } from "@im/ui";
import { PAYMENT_STATUS, POLICY_STATUS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { DAY, getCategoryMap, getCustomers, getOrgNames, shortName } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { DocumentUpload } from "@/components/partner/document-upload";
import { RealtimeRefresh } from "@/components/partner/realtime-refresh";
import { Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";
import { declineIssuance, issuePolicy, recordPolicyDocuments } from "./actions";

export const metadata: Metadata = { title: "Issuance" };

const DOC_KINDS = [
  { value: "policy_schedule", label: "Policy schedule" },
  { value: "certificate", label: "Certificate" },
  { value: "policy_wording", label: "Policy wording" },
  { value: "endorsement", label: "Endorsement" },
  { value: "other", label: "Other" },
];

export default function IssuancePage() {
  return (
    <>
      <PageHeader title="Issuance" description="Payment confirmation never activates cover. Review, accept the risk and issue — only you can make a policy active." />
      <Suspense fallback={<PageSkeleton stats={0} rows={4} />}>
        <Issuance />
      </Suspense>
    </>
  );
}

async function Issuance() {
  const ctx = await requireKind("insurer");
  const sb = ctx.supabase;
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    sb.from("policies").select("*").eq("insurer_org_id", ctx.orgId).eq("status", "pending_issuance").order("created_at"),
    sb.from("policies").select("*").eq("insurer_org_id", ctx.orgId).eq("status", "active").gte("issued_at", since).order("issued_at", { ascending: false }).limit(20),
  ]);
  const all = [...(pending ?? []), ...(recent ?? [])];
  const ids = all.map((p) => p.id);
  const reqIds = all.map((p) => p.request_id).filter((x): x is string => !!x);
  const [cats, customers, brokers, { data: payments }, { data: docs }, { data: requests }] = await Promise.all([
    getCategoryMap(),
    getCustomers(ctx, all.map((p) => p.customer_id)),
    getOrgNames(ctx, all.map((p) => p.broker_org_id)),
    ids.length ? sb.from("payments").select("id, policy_id, request_id, status, amount, channel, provider, provider_reference, paid_at, reconciled").or(`policy_id.in.(${ids.join(",")})${reqIds.length ? `,request_id.in.(${reqIds.join(",")})` : ""}`) : Promise.resolve({ data: [] }),
    ids.length ? sb.from("documents").select("id, policy_id, file_name, kind, created_at").in("policy_id", ids) : Promise.resolve({ data: [] }),
    reqIds.length ? sb.from("requests").select("id, reference, status").in("id", reqIds) : Promise.resolve({ data: [] }),
  ]);
  const reqOf = new Map((requests ?? []).map((r) => [r.id, r]));
  const canAct = can(ctx, ROLES.underwrite);
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 364 * DAY).toISOString().slice(0, 10);

  return (
    <>
      <div className="mb-4 flex justify-end"><RealtimeRefresh table="policies" filter={`insurer_org_id=eq.${ctx.orgId}`} channel={`issuance-${ctx.orgId}`} /></div>
      {(pending ?? []).length === 0 ? (
        <EmptyState title="No policies awaiting issuance" body="When a customer's payment is confirmed, the policy appears here for you to accept and issue." />
      ) : (
        <div className="space-y-6">
          {(pending ?? []).map((p) => {
            const pay = (payments ?? []).filter((x) => x.policy_id === p.id || (p.request_id && x.request_id === p.request_id));
            const confirmed = pay.find((x) => x.status === "succeeded");
            const req = p.request_id ? reqOf.get(p.request_id) : undefined;
            return (
              <Section
                key={p.id}
                title={`${p.internal_reference} · ${shortName(customers.get(p.customer_id))}`}
                description={`${cats.get(p.category_id)?.name ?? ""} · broker of record ${brokers.get(p.broker_org_id ?? "") ?? "—"}${req ? ` · request ${req.reference}` : ""}`}
                actions={<StatusPill meta={POLICY_STATUS[p.status]} />}
              >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Payment confirmation</h3>
                    {pay.length === 0 ? <Empty>No payment recorded.</Empty> : pay.map((x) => (
                      <div key={x.id} className="mt-1">
                        <KV label="Status"><StatusPill meta={PAYMENT_STATUS[x.status]} /></KV>
                        <KV label="Amount">{formatGHS(Number(x.amount), { decimals: true })}</KV>
                        <KV label="Channel">{x.channel ? humanize(x.channel) : "—"} · {x.provider}</KV>
                        <KV label="Provider reference">{x.provider_reference ?? "—"}</KV>
                        <KV label="Paid">{formatDateTime(x.paid_at)}</KV>
                        <KV label="Reconciled">{x.reconciled ? "Yes" : <Pill tone="wait">Not yet</Pill>}</KV>
                      </div>
                    ))}
                    <div className="mt-3">
                      <KV label="Premium">{formatGHS(p.premium != null ? Number(p.premium) : null)}</KV>
                      <KV label="Sum insured">{formatGHS(p.sum_insured != null ? Number(p.sum_insured) : null)}</KV>
                      <KV label="Excess">{formatGHS(p.excess != null ? Number(p.excess) : null)}</KV>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {!canAct ? <p className="text-sm text-muted">Underwriters issue policies.</p> : !confirmed ? (
                      <Notice tone="wait" title="Waiting for payment confirmation">Issue only after the payment provider confirms the premium.</Notice>
                    ) : (
                      <>
                        <ActionForm action={issuePolicy} submitLabel="Issue policy" confirm="Issue this policy? Cover becomes active from the start date.">
                          <input type="hidden" name="policyId" value={p.id} />
                          <Field label="Insurer policy number" htmlFor={`pn-${p.id}`}>
                            <Input id={`pn-${p.id}`} name="policyNumber" required minLength={3} className="h-10 text-sm" placeholder="e.g. CG/MTR/2026/001234" />
                          </Field>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Cover start" htmlFor={`cs-${p.id}`}>
                              <Input id={`cs-${p.id}`} name="coverStart" type="date" required defaultValue={p.cover_start ?? today} className="h-10 text-sm" />
                            </Field>
                            <Field label="Cover end" htmlFor={`ce-${p.id}`}>
                              <Input id={`ce-${p.id}`} name="coverEnd" type="date" required defaultValue={p.cover_end ?? nextYear} className="h-10 text-sm" />
                            </Field>
                          </div>
                        </ActionForm>
                        <details className="rounded-xl border border-line p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-danger">Decline risk</summary>
                          <ActionForm action={declineIssuance} submitLabel="Decline and notify" variant="danger" className="mt-3 space-y-3" confirm="Decline this risk? The application will be marked rejected.">
                            <input type="hidden" name="policyId" value={p.id} />
                            <Field label="Reason" htmlFor={`dr-${p.id}`}>
                              <Textarea id={`dr-${p.id}`} name="reason" rows={2} required className="min-h-16 text-sm" />
                            </Field>
                          </ActionForm>
                        </details>
                      </>
                    )}
                  </div>
                </div>
              </Section>
            );
          })}
        </div>
      )}

      <Section className="mt-8" title="Recently issued" description="Upload the schedule and certificate. The broker delivers them to the customer and completes the request (insurers can't update requests).">
        {(recent ?? []).length === 0 ? <Empty>Nothing issued in the last 30 days.</Empty> : (
          <div className="space-y-4">
            {(recent ?? []).map((p) => {
              const pdocs = (docs ?? []).filter((d) => d.policy_id === p.id);
              const req = p.request_id ? reqOf.get(p.request_id) : undefined;
              return (
                <div key={p.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{p.policy_number} · {shortName(customers.get(p.customer_id))}</p>
                      <p className="text-xs text-muted">Issued {formatDateTime(p.issued_at)} · cover {formatDate(p.cover_start)} – {formatDate(p.cover_end)}{req ? ` · request ${req.reference} (${humanize(req.status)})` : ""}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pdocs.length === 0 ? <Pill tone="wait">No documents yet</Pill> : pdocs.map((d) => <Pill key={d.id} tone="ok">{humanize(d.kind)}</Pill>)}
                    </div>
                  </div>
                  {canAct && (
                    <div className="mt-3">
                      <DocumentUpload customerId={p.customer_id} scope="policies" kinds={DOC_KINDS} hidden={{ policyId: p.id }} action={recordPolicyDocuments} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
