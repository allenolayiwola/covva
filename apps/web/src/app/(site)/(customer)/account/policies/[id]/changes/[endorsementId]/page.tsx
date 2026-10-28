import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ENDORSEMENT_KINDS, ENDORSEMENT_STATUS, adjustmentLabel, formatDate, formatDateTime, type EndorsementKind, type EndorsementStatus } from "@im/core";
import { Card, DefinitionList, Notice, StatusPill } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { AgreeChangeForm, WithdrawChangeForm } from "@/components/customer/policy-change-actions";
import { PageSkeleton } from "@/components/customer/skeletons";
import { syncEndorsementPayment } from "@/server/endorsements";
import { UUID_RE, account, getPolicyOr404, policyTitle } from "../../../../_lib/data";
import { agreeToPolicyChange, withdrawPolicyChange } from "../../change-actions";

export const metadata: Metadata = { title: "Policy change" };

export default function PolicyChangePage({ params, searchParams }: PageProps<"/account/policies/[id]/changes/[endorsementId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <ChangeDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type Line = { label: string; before: string; after: string };

async function ChangeDetail({ params, searchParams }: Pick<PageProps<"/account/policies/[id]/changes/[endorsementId]">, "params" | "searchParams">) {
  const { id, endorsementId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id) || !UUID_RE.test(endorsementId)) notFound();
  const { user, supabase } = await account(`/account/policies/${id}/changes/${endorsementId}`);
  const policy = await getPolicyOr404(supabase, id);
  const { data: first } = await supabase.from("endorsements").select("*").eq("id", endorsementId).eq("policy_id", id).maybeSingle();
  if (!first) notFound();
  let e = first;
  let paymentStatus: string | null = null;
  if (e.adjustment_payment_id) {
    paymentStatus = (await syncEndorsementPayment(e.id)).status;
    e = (await supabase.from("endorsements").select("*").eq("id", endorsementId).maybeSingle()).data ?? e;
  }
  const status = e.status as EndorsementStatus;
  const meta = ENDORSEMENT_STATUS[status] ?? { label: e.status, tone: "neutral" as const, hint: "" };
  const def = ENDORSEMENT_KINDS[e.kind as EndorsementKind];
  const changes = (e.changes ?? {}) as { lines?: Line[]; after?: Record<string, unknown> };
  const lines = changes.lines ?? [];
  const amount = e.premium_adjustment == null ? null : Number(e.premium_adjustment);
  const isCustomer = e.customer_id === user.id;
  const awaitingAgreement = isCustomer && status === "quoted" && !e.customer_accepted_at;
  const awaitingPayment = isCustomer && !!e.customer_accepted_at && (amount ?? 0) > 0 && paymentStatus !== "succeeded" && ["quoted", "accepted"].includes(status);

  return (
    <div>
      <Breadcrumbs items={[{ label: "My policies", href: "/account/policies" }, { label: policyTitle(policy), href: `/account/policies/${id}` }, { label: e.reference }]} />
      {sp.sent && <Notice tone="ok" className="mb-5">Your change has been sent. Your insurer will confirm any change in premium.</Notice>}
      {sp.paid && paymentStatus !== "succeeded" && <Notice tone="wait" className="mb-5">We&apos;re waiting for the payment provider to confirm your payment. This page updates when it does.</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Policy change {e.reference}</p>
          <h1 className="text-2xl font-semibold text-ink">{def?.label ?? e.kind}</h1>
          <p className="mt-1 text-sm text-muted">Starts {formatDate(e.effective_from)} · requested {formatDateTime(e.created_at)}</p>
        </div>
        <StatusPill meta={meta} />
      </div>
      <p className="mt-3 text-sm text-ink-2">{meta.hint}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-5" as="section" aria-labelledby="what-h">
            <h2 id="what-h" className="font-semibold text-ink">What changes</h2>
            {lines.length ? (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Detail</th><th className="pb-2 font-medium">Now</th><th className="pb-2 font-medium">After the change</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {lines.map((l) => <tr key={l.label}><td className="py-2 pr-3 text-ink-2">{l.label}</td><td className="py-2 pr-3 text-muted">{l.before}</td><td className="py-2 font-medium text-ink">{l.after}</td></tr>)}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-muted">No details recorded.</p>
            )}
          </Card>
          {(e.broker_note || e.insurer_note) && (
            <Card className="p-5" as="section" aria-labelledby="notes-h">
              <h2 id="notes-h" className="font-semibold text-ink">Notes</h2>
              {e.broker_note && <p className="mt-2 text-sm text-ink-2"><span className="font-medium">Your broker:</span> {e.broker_note}</p>}
              {e.insurer_note && <p className="mt-2 text-sm text-ink-2"><span className="font-medium">The insurer:</span> {e.insurer_note}</p>}
            </Card>
          )}
        </div>
        <aside className="space-y-5">
          <Card className="p-5">
            <p className="text-sm text-muted">Change in premium</p>
            <p className="mt-1 text-lg font-semibold text-ink">{adjustmentLabel(amount, e.currency)}</p>
            {amount == null && e.proposed_adjustment != null && <p className="mt-1 text-xs text-muted">Indicative estimate {adjustmentLabel(e.proposed_adjustment, e.currency).toLowerCase()} — not binding until the insurer confirms.</p>}
            <DefinitionList
              className="mt-3"
              items={[
                ...(e.customer_accepted_at ? [{ label: "You agreed", value: formatDateTime(e.customer_accepted_at) }] : []),
                ...(paymentStatus ? [{ label: "Payment", value: paymentStatus === "succeeded" ? "Paid to the insurer" : paymentStatus.replace(/_/g, " ") }] : []),
                ...(e.decided_at ? [{ label: status === "rejected" ? "Not accepted" : "Insurer accepted", value: formatDateTime(e.decided_at) }] : []),
                ...(e.applied_at ? [{ label: "Policy updated", value: formatDateTime(e.applied_at) }] : []),
                ...(e.refund_status === "manual" ? [{ label: "Refund", value: "The insurer returns it to your payment method" }] : []),
              ]}
            />
            {(awaitingAgreement || awaitingPayment) && (
              <div className="mt-4 border-t border-line pt-4">
                <AgreeChangeForm action={agreeToPolicyChange.bind(null, id, e.id)} amount={amount ?? 0} currency={e.currency} />
              </div>
            )}
          </Card>
          {isCustomer && ["draft", "submitted", "quoted"].includes(status) && (
            <Card className="p-5">
              <WithdrawChangeForm action={withdrawPolicyChange.bind(null, id, e.id)} />
            </Card>
          )}
          <p className="text-xs text-subtle">Only the insurer changes cover. Covva is a technology platform and never holds your premium.{e.request_id && <> <Link href={`/account/requests/${e.request_id}`} className="text-brand hover:underline">See the request timeline</Link></>}</p>
        </aside>
      </div>
    </div>
  );
}
