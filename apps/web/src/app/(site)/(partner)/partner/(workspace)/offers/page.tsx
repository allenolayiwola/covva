import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, Field, Notice, PageHeader, Pill, Textarea } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import type { RiskField } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { getCategoryMap, nowMs, requestKind } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { OfferCountdown } from "@/components/partner/offer-countdown";
import { riskDisplay } from "@/components/partner/risk-fields";
import { Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";
import { acceptOffer, declineOffer } from "./actions";

export const metadata: Metadata = { title: "Offers" };

export default function OffersPage() {
  return (
    <>
      <PageHeader
        title="Offers"
        description="New requests offered to your organisation. The first broker to accept becomes broker of record; unanswered offers move to the next broker when the timer runs out."
      />
      <Suspense fallback={<PageSkeleton stats={0} rows={3} />}>
        <Offers />
      </Suspense>
    </>
  );
}

async function Offers() {
  const ctx = await requireKind("broker");
  const sb = ctx.supabase;
  const since = new Date(nowMs() - 7 * 86_400_000).toISOString();
  const [{ data: open }, { data: past }, cats] = await Promise.all([
    sb.from("order_offers").select("id, request_id, status, round, offered_at, responds_by").eq("broker_org_id", ctx.orgId).eq("status", "offered").order("responds_by"),
    sb.from("order_offers").select("id, request_id, status, round, offered_at, responds_by, responded_at, decline_reason").eq("broker_org_id", ctx.orgId).neq("status", "offered").gte("offered_at", since).order("offered_at", { ascending: false }).limit(20),
    getCategoryMap(),
  ]);
  const ids = [...new Set([...(open ?? []), ...(past ?? [])].map((o) => o.request_id))];
  const { data: requests } = ids.length
    ? await sb.from("requests").select("id, reference, title, type, status, category_id, risk_data, created_at, complexity_flags, talk_to_expert").in("id", ids)
    : { data: [] };
  const reqOf = new Map((requests ?? []).map((r) => [r.id, r]));
  const canAct = can(ctx, ROLES.brokerWork);
  const now = nowMs();
  const live = (open ?? []).filter((o) => new Date(o.responds_by).getTime() > now);

  return (
    <>
      {!canAct && <Notice tone="wait" className="mb-4">Advisers and supervisors accept requests. Your role can view offers only.</Notice>}
      {live.length === 0 ? (
        <EmptyState title="No open offers" body="When a customer's request matches your appointments and capacity, it appears here with a timer. You also get a push, SMS and email with a one-tap accept link." />
      ) : (
        <div className="space-y-6">
          {live.map((o) => {
            const r = reqOf.get(o.request_id);
            const cat = r ? cats.get(r.category_id) : undefined;
            const fields = (cat?.risk_schema ?? []) as unknown as RiskField[];
            const riskData = (r?.risk_data ?? {}) as Record<string, unknown>;
            const risk = fields.filter((f) => riskData[f.key] !== undefined && riskData[f.key] !== "").slice(0, 6).map((f) => ({ label: f.label, value: riskDisplay(f, riskData[f.key]) }));
            return (
              <Section
                key={o.id}
                title={r ? `${r.reference} · ${requestKind(cat?.name, r.type)}` : "Request"}
                description={`Offered ${formatDateTime(o.offered_at)} · round ${o.round}`}
                actions={<OfferCountdown respondsBy={o.responds_by} />}
              >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <p className="font-medium text-ink">{r?.title ?? "Customer request"}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r?.talk_to_expert && <Pill tone="wait">Wants to talk to an expert</Pill>}
                      {(r?.complexity_flags ?? []).map((f) => <Pill key={f} tone="neutral">{humanize(f)}</Pill>)}
                    </div>
                    <div className="mt-3">
                      {risk.length ? risk.map((kv) => <KV key={kv.label} label={kv.label}>{kv.value}</KV>) : <Empty>Risk details are shown once you accept.</Empty>}
                    </div>
                    <p className="mt-3 text-xs text-muted">The customer&apos;s name and contact details are shared with the broker of record only.</p>
                  </div>
                  <div className="space-y-4">
                    {canAct ? (
                      <>
                        <ActionForm action={acceptOffer} submitLabel="Accept and become broker of record" pendingLabel="Accepting…" confirm="Accept this request? Your organisation becomes the broker of record and must service it within the SLA.">
                          <input type="hidden" name="offerId" value={o.id} />
                        </ActionForm>
                        <details className="rounded-xl border border-line p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-muted">Decline</summary>
                          <ActionForm action={declineOffer} submitLabel="Decline offer" variant="secondary" className="mt-3 space-y-3">
                            <input type="hidden" name="offerId" value={o.id} />
                            <Field label="Reason (optional)" htmlFor={`dr-${o.id}`}>
                              <Textarea id={`dr-${o.id}`} name="reason" rows={2} maxLength={500} className="min-h-16 text-sm" placeholder="e.g. outside our region, at capacity" />
                            </Field>
                          </ActionForm>
                        </details>
                      </>
                    ) : (
                      <p className="text-sm text-muted">Ask an adviser or supervisor to accept this offer.</p>
                    )}
                  </div>
                </div>
              </Section>
            );
          })}
        </div>
      )}

      <Section className="mt-8" title="Recent offers" description="Accepted, declined and expired offers from the last 7 days.">
        {(past ?? []).length === 0 ? <Empty>No earlier offers.</Empty> : (
          <ul className="divide-y divide-line">
            {(past ?? []).map((o) => {
              const r = reqOf.get(o.request_id);
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    {o.status === "accepted" && r ? <Link href={`/partner/requests/${r.id}`} className="font-medium text-brand hover:underline">{r.reference}</Link> : <span className="font-medium text-ink">{r?.reference ?? "Request"}</span>}
                    <span className="text-muted"> · {r?.title ?? ""}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {formatDateTime(o.responded_at ?? o.responds_by)}
                    <Pill tone={o.status === "accepted" ? "ok" : o.status === "declined" ? "neutral" : "wait"}>{humanize(o.status)}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
