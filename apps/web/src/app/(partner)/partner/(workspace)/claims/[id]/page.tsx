import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge, Field, Input, Notice, Pill, Select, StatusPill, Textarea, Timeline } from "@im/ui";
import { CLAIM_STATUS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { DECIDABLE, INSURER_STEPS } from "../../../_lib/claims";
import { getCategoryMap, getCustomers, getOrgNames, getTeam, shortName } from "../../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, KV, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { claimStep, decideClaim, markClaimPaid } from "../actions";

export const metadata: Metadata = { title: "Claim" };

export default function ClaimPage({ params }: PageProps<"/partner/claims/[id]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Claim params={params} />
    </Suspense>
  );
}

const STEP_LABEL: Record<string, string> = {
  acknowledged: "Acknowledge claim",
  under_assessment: "Start assessment",
  info_requested: "Request more information",
  closed: "Close claim",
};

async function Claim({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKind("insurer");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = ctx.supabase;
  const { data: claim } = await sb.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim || claim.insurer_org_id !== ctx.orgId) notFound();

  const [{ data: policy }, { data: events }, { data: docs }, customers, brokers, cats, team] = await Promise.all([
    sb.from("policies").select("id, policy_number, internal_reference, category_id, cover_start, cover_end, sum_insured, excess, status").eq("id", claim.policy_id).maybeSingle(),
    sb.from("claim_events").select("*").eq("claim_id", id).order("created_at"),
    sb.from("documents").select("id, file_name, kind, storage_path, uploaded_by_party, delivered_to_insurer_at, created_at").eq("claim_id", id).order("created_at"),
    getCustomers(ctx, [claim.customer_id]),
    getOrgNames(ctx, [claim.broker_org_id]),
    getCategoryMap(),
    getTeam(ctx),
  ]);
  const signed = (docs ?? []).length ? await sb.storage.from("documents").createSignedUrls((docs ?? []).map((d) => d.storage_path), 600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const members = new Map(team.map((m) => [m.userId, m.name]));
  const steps = INSURER_STEPS[claim.status] ?? [];
  const canAct = can(ctx, ROLES.claims);
  const evidence = (claim.required_evidence ?? []) as unknown as (string | { label?: string; key?: string; received?: boolean })[];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/claims" className="hover:text-brand">Claims</Link> <span aria-hidden>›</span> {claim.reference}
      </nav>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{claim.reference} · {shortName(customers.get(claim.customer_id))}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {claim.incident_type} · {formatDateTime(claim.incident_at)}{claim.location ? ` · ${claim.location}` : ""}
          <StatusPill meta={CLAIM_STATUS[claim.status]} />
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Section title="What happened">
            <p className="whitespace-pre-wrap text-sm text-ink-2">{claim.description ?? "No description."}</p>
            <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
              <KV label="Amount claimed">{formatGHS(claim.amount_claimed != null ? Number(claim.amount_claimed) : null)}</KV>
              <KV label="Reported">{formatDateTime(claim.reported_at)}</KV>
              <KV label="Delivered to you">{formatDateTime(claim.delivered_to_insurer_at)}</KV>
              <KV label="Acknowledged">{formatDateTime(claim.acknowledged_at)}</KV>
              <KV label="Your reference">{claim.insurer_reference ?? "—"}</KV>
              <KV label="Broker of record">{brokers.get(claim.broker_org_id ?? "") ?? "—"}</KV>
            </div>
            {Array.isArray(claim.third_parties) && claim.third_parties.length > 0 && (
              <p className="mt-3 text-sm text-muted">Third parties: {(claim.third_parties as unknown[]).length}</p>
            )}
          </Section>

          <Section title="Evidence" description="Customer and broker uploads for this claim.">
            {evidence.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-1.5">
                {evidence.map((e, i) => {
                  const label = typeof e === "string" ? e : (e.label ?? e.key ?? "Item");
                  return <li key={i}><Pill tone={typeof e === "object" && e.received ? "ok" : "neutral"}>{humanize(label)}</Pill></li>;
                })}
              </ul>
            )}
            {(docs ?? []).length === 0 ? <Empty>No evidence uploaded yet.</Empty> : (
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {(docs ?? []).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <a href={urls.get(d.storage_path) ?? undefined} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand">{d.file_name}</a>
                      <p className="text-xs text-muted">{humanize(d.kind)} · from {d.uploaded_by_party} · {formatDateTime(d.created_at)}</p>
                    </div>
                    {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered {formatDate(d.delivered_to_insurer_at)}</Pill> : <Pill>Not yet delivered by broker</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="History" description="Every status change and note, in order.">
            {(events ?? []).length === 0 ? <Empty>No events.</Empty> : (
              <Timeline
                steps={(events ?? []).map((e, i, arr) => ({
                  state: i === arr.length - 1 ? "current" : "done",
                  title: e.to_status ? CLAIM_STATUS[e.to_status].label : "Note",
                  detail: (
                    <>
                      {formatDateTime(e.created_at)} · {e.actor_id && members.get(e.actor_id) ? members.get(e.actor_id) : humanize(e.actor_party)}
                      {!e.visible_to_customer && " · internal"}
                      {e.note && <p className="mt-0.5 text-ink-2">{e.note}</p>}
                    </>
                  ),
                }))}
              />
            )}
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Policy">
            {policy ? (
              <>
                <KV label="Policy number">{policy.policy_number ?? policy.internal_reference}</KV>
                <KV label="Category">{cats.get(policy.category_id)?.name ?? "—"}</KV>
                <KV label="Cover">{formatDate(policy.cover_start)} – {formatDate(policy.cover_end)}</KV>
                <KV label="Sum insured">{formatGHS(policy.sum_insured != null ? Number(policy.sum_insured) : null)}</KV>
                <KV label="Excess">{formatGHS(policy.excess != null ? Number(policy.excess) : null)}</KV>
                <KV label="Policy status">{humanize(policy.status)}</KV>
              </>
            ) : <Empty>Policy not visible.</Empty>}
          </Section>

          {claim.decision_at && (
            <Notice tone={claim.status === "rejected" ? "danger" : "ok"} title={`Decision: ${CLAIM_STATUS[claim.status === "paid" || claim.status === "closed" ? "approved" : claim.status].label}`}>
              {claim.decision_amount != null && <p>Amount: {formatGHS(Number(claim.decision_amount))}</p>}
              {claim.decision_note && <p>{claim.decision_note}</p>}
              <p className="text-xs">Recorded {formatDateTime(claim.decision_at)}{claim.decision_by && members.get(claim.decision_by) ? ` by ${members.get(claim.decision_by)}` : ""}</p>
            </Notice>
          )}

          {canAct && (
            <Section title="Handle claim">
              {steps.length === 0 && !DECIDABLE.includes(claim.status) && !["approved", "partially_approved"].includes(claim.status) && <Empty>No further actions.</Empty>}
              <div className="space-y-4">
                {steps.map((to) => (
                  <ActionForm key={to} action={claimStep} submitLabel={STEP_LABEL[to] ?? humanize(to)} variant={to === "acknowledged" ? "primary" : "secondary"} className="space-y-2">
                    <input type="hidden" name="claimId" value={claim.id} />
                    <input type="hidden" name="to" value={to} />
                    {to === "acknowledged" && (
                      <Field label="Your claim reference (optional)" htmlFor="ins-ref">
                        <Input id="ins-ref" name="insurerReference" className="h-10 text-sm" defaultValue={claim.insurer_reference ?? ""} />
                      </Field>
                    )}
                    {to === "info_requested" && (
                      <Field label="What do you need?" htmlFor="ir-note">
                        <Textarea id="ir-note" name="note" rows={2} required className="min-h-16 text-sm" />
                      </Field>
                    )}
                  </ActionForm>
                ))}

                {DECIDABLE.includes(claim.status) && (
                  <div className="rounded-xl border border-line p-4">
                    <h3 className="font-semibold text-ink">Record decision</h3>
                    <p className="mb-3 text-xs text-muted">Shared with the customer and broker. A decline needs a written reason referencing the policy terms.</p>
                    <ActionForm action={decideClaim} submitLabel="Record decision" confirm="Record this claim decision? The customer and broker are notified." className="space-y-3">
                      <input type="hidden" name="claimId" value={claim.id} />
                      <Field label="Decision" htmlFor="dc-dec">
                        <Select id="dc-dec" name="decision" className="h-10 text-sm">
                          <option value="approved">Approve</option>
                          <option value="partially_approved">Partially approve</option>
                          <option value="rejected">Decline</option>
                        </Select>
                      </Field>
                      <Field label="Approved amount (GH₵)" htmlFor="dc-amt" hint="Required for partial approval. Defaults to the claimed amount when approving.">
                        <Input id="dc-amt" name="amount" type="number" min={0} step="0.01" className="h-10 text-sm" />
                      </Field>
                      <Field label="Reason / explanation" htmlFor="dc-reason">
                        <Textarea id="dc-reason" name="reason" rows={3} className="min-h-20 text-sm" />
                      </Field>
                    </ActionForm>
                  </div>
                )}

                {["approved", "partially_approved"].includes(claim.status) && (
                  <ActionForm action={markClaimPaid} submitLabel="Mark paid" className="space-y-2">
                    <input type="hidden" name="claimId" value={claim.id} />
                    <Field label="Settlement reference" htmlFor="pd-ref">
                      <Input id="pd-ref" name="reference" className="h-10 text-sm" />
                    </Field>
                  </ActionForm>
                )}
              </div>
            </Section>
          )}
        </aside>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
