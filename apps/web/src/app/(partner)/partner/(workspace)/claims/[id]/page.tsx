import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Checkbox, DemoBadge, Field, Input, Notice, Pill, Select, StatusPill, Textarea, Timeline } from "@im/ui";
import {
  CLAIM_JOB_STATUS,
  CLAIM_STATUS,
  FRAUD_KIND_LABELS,
  FRAUD_STATUS_LABELS,
  SERVICE_PARTNER_KIND_LABELS,
  buildClaimTimeline,
  formatDate,
  formatDateTime,
  formatGHS,
  humanize,
  partnerKindsFor,
  type FraudKind,
  type FraudStatus,
  type ServicePartnerKind,
} from "@im/core";
import { can, getPartnerContext, ROLES } from "../../../_lib/context";
import { DECIDABLE, INSURER_STEPS } from "../../../_lib/claims";
import { getCategoryMap, getCustomers, getOrgNames, getTeam, shortName } from "../../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, KV, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { listClaimJobs, listClaimMessages, listServicePartners } from "@/server/claims";
import {
  claimStep,
  decideClaim,
  markClaimPaid,
  partnerAssignJob,
  partnerClaimMessage,
  partnerFulfilInfo,
  partnerRequestInfo,
  partnerRerunFraudChecks,
  partnerReviewFraudFlag,
  partnerUpdateJob,
} from "../actions";

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

const CLOSED = ["paid", "closed", "withdrawn", "rejected"];

async function Claim({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPartnerContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = ctx.supabase;
  const { data: claim } = await sb.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim) notFound();
  const isInsurer = ctx.kind === "insurer" && claim.insurer_org_id === ctx.orgId;
  const isBroker = ctx.kind === "broker" && claim.broker_org_id === ctx.orgId;
  if (!isInsurer && !isBroker) notFound();

  const [{ data: policy }, { data: events }, { data: docs }, customers, orgs, cats, team, messages, { data: infoRequests }, jobs, { data: flags }] = await Promise.all([
    sb.from("policies").select("id, policy_number, internal_reference, category_id, cover_start, cover_end, sum_insured, excess, status, category:product_categories(slug)").eq("id", claim.policy_id).maybeSingle(),
    sb.from("claim_events").select("*").eq("claim_id", id).order("created_at"),
    sb.from("documents").select("id, file_name, kind, storage_path, uploaded_by_party, delivered_to_insurer_at, duration_seconds, created_at").eq("claim_id", id).order("created_at"),
    getCustomers(ctx, [claim.customer_id]),
    getOrgNames(ctx, [claim.broker_org_id, claim.insurer_org_id]),
    getCategoryMap(),
    getTeam(ctx),
    listClaimMessages(sb, id),
    sb.from("claim_info_requests").select("*").eq("claim_id", id).order("created_at", { ascending: false }),
    listClaimJobs(sb, id),
    isInsurer ? sb.from("claim_fraud_flags").select("*").eq("claim_id", id).order("created_at") : Promise.resolve({ data: [] as never[] }),
  ]);
  const signed = (docs ?? []).length ? await sb.storage.from("documents").createSignedUrls((docs ?? []).map((d) => d.storage_path), 600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const members = new Map(team.map((m) => [m.userId, m.name]));
  const steps = INSURER_STEPS[claim.status] ?? [];
  const canAct = isInsurer && can(ctx, ROLES.claims);
  const canWork = isInsurer ? can(ctx, ROLES.claims) : can(ctx, ROLES.brokerWork);
  const closed = CLOSED.includes(claim.status);
  const evidence = (claim.required_evidence ?? []) as unknown as (string | { label?: string; key?: string; received?: boolean })[];
  const slug = (policy?.category as unknown as { slug: string } | null)?.slug;
  const kinds: ServicePartnerKind[] = partnerKindsFor(slug, claim.incident_type);
  const partners = kinds.length ? await listServicePartners(sb, { kind: kinds, insurerOrgId: claim.insurer_org_id, limit: 100 }).catch(() => []) : await listServicePartners(sb, { insurerOrgId: claim.insurer_org_id, limit: 100 }).catch(() => []);
  const openRequests = (infoRequests ?? []).filter((r) => !r.fulfilled_at);
  const fraudStatus = ((claim as { fraud_status?: string }).fraud_status ?? "clear") as FraudStatus;
  const fraudScore = (claim as { fraud_score?: number | string | null }).fraud_score;
  const stages = buildClaimTimeline(claim, events ?? []);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href={isInsurer ? "/partner/claims" : "/partner/service#claims"} className="hover:text-brand">Claims</Link> <span aria-hidden>›</span> {claim.reference}
      </nav>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{claim.reference} · {shortName(customers.get(claim.customer_id))}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {claim.incident_type} · {formatDateTime(claim.incident_at)}{claim.location ? ` · ${claim.location}` : ""}
          <StatusPill meta={CLAIM_STATUS[claim.status]} />
          {isInsurer && fraudStatus !== "clear" && <Pill tone={FRAUD_STATUS_LABELS[fraudStatus].tone}>{FRAUD_STATUS_LABELS[fraudStatus].label}</Pill>}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Section title="What happened">
            <p className="whitespace-pre-wrap text-sm text-ink-2">{claim.description ?? "No description."}</p>
            <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
              <KV label="Amount claimed">{formatGHS(claim.amount_claimed != null ? Number(claim.amount_claimed) : null)}</KV>
              <KV label="Reported">{formatDateTime(claim.reported_at)}</KV>
              <KV label="Delivered to insurer">{formatDateTime(claim.delivered_to_insurer_at)}</KV>
              <KV label="Acknowledged">{formatDateTime(claim.acknowledged_at)}</KV>
              <KV label="Insurer reference">{claim.insurer_reference ?? "—"}</KV>
              <KV label={isInsurer ? "Broker of record" : "Insurer"}>{isInsurer ? (orgs.get(claim.broker_org_id ?? "") ?? "—") : (orgs.get(claim.insurer_org_id) ?? "—")}</KV>
            </div>
            {Array.isArray(claim.third_parties) && claim.third_parties.length > 0 && (
              <p className="mt-3 text-sm text-muted">Third parties: {(claim.third_parties as unknown[]).length}</p>
            )}
          </Section>

          <Section title="Information requests" description="What has been asked of the customer or the broker, and whether it has been answered.">
            {(infoRequests ?? []).length === 0 ? <Empty>Nothing requested yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {(infoRequests ?? []).map((r) => (
                  <li key={r.id} className="rounded-xl border border-line px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Pill tone={r.fulfilled_at ? "ok" : "wait"}>{r.fulfilled_at ? "Answered" : "Open"}</Pill>
                      {humanize(r.kind)} · asked of the {r.requested_party} by {r.requested_by && members.get(r.requested_by) ? members.get(r.requested_by) : humanize(r.requested_by_party)} · {formatDateTime(r.created_at)}{r.due_at ? ` · due ${formatDate(r.due_at)}` : ""}
                    </p>
                    <p className="mt-1 text-ink">{r.message}</p>
                    {r.fulfilled_at && <p className="mt-1 text-xs text-ink-2">Answered {formatDateTime(r.fulfilled_at)}{r.response ? `: ${r.response}` : ""}{r.document_id ? " · document attached" : ""}</p>}
                    {!r.fulfilled_at && canWork && !closed && (r.requested_party === "broker" ? isBroker : isBroker || isInsurer) && (
                      <ActionForm action={partnerFulfilInfo} submitLabel="Mark answered" variant="outline" size="sm" inline className="mt-2">
                        <input type="hidden" name="claimId" value={claim.id} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <Input name="response" placeholder="What was provided (optional)" className="h-9 w-64 text-sm" maxLength={2000} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWork && !closed && (
              <ActionForm action={partnerRequestInfo} submitLabel="Send request" variant="secondary" className="mt-4 rounded-xl border border-line p-4" resetOnSuccess>
                <h3 className="font-semibold text-ink">Ask for something</h3>
                <input type="hidden" name="claimId" value={claim.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="What" htmlFor="ir-kind">
                    <Select id="ir-kind" name="kind" className="h-10 text-sm">
                      <option value="document">A document</option>
                      <option value="information">Information</option>
                      <option value="inspection">An inspection slot</option>
                    </Select>
                  </Field>
                  <Field label="From" htmlFor="ir-party">
                    <Select id="ir-party" name="requestedParty" className="h-10 text-sm">
                      <option value="customer">The customer</option>
                      {isInsurer && <option value="broker">The broker</option>}
                    </Select>
                  </Field>
                  <Field label="Needed by" htmlFor="ir-due">
                    <Input id="ir-due" name="dueAt" type="date" className="h-10 text-sm" />
                  </Field>
                </div>
                <Field label="Message" htmlFor="ir-msg">
                  <Textarea id="ir-msg" name="message" rows={2} required className="min-h-16 text-sm" placeholder="e.g. Please upload the repair estimate from the garage" />
                </Field>
                {isInsurer && ["acknowledged", "under_assessment", "delivered_to_insurer"].includes(claim.status) && <Checkbox name="setStatus" label="Also move the claim to “More information needed”" />}
                <p className="text-xs text-muted">The customer is told by push, email and SMS and can upload or reply from the claim page.</p>
              </ActionForm>
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
                      <p className="text-xs text-muted">{humanize(d.kind)}{d.duration_seconds != null ? ` · ${d.duration_seconds}s` : ""} · from {d.uploaded_by_party} · {formatDateTime(d.created_at)}</p>
                    </div>
                    {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered {formatDate(d.delivered_to_insurer_at)}</Pill> : <Pill>Not yet delivered by broker</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Messages" description="The customer sees everything except internal notes, which stay between the broker, the insurer and platform staff.">
            {messages.length === 0 ? <Empty>No messages yet.</Empty> : (
              <ol className="space-y-2 text-sm">
                {messages.map((m) => (
                  <li key={m.id} className={`rounded-xl px-4 py-3 ${m.internal ? "border border-dashed border-amber/60 bg-amber-bg/40" : "border border-line bg-white"}`}>
                    <p className="text-xs text-muted">
                      {m.author_id && members.get(m.author_id) ? members.get(m.author_id) : humanize(m.author_party)} · {formatDateTime(m.created_at)}{m.internal && <span className="ml-2 font-semibold text-amber">Internal note</span>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
                    {Array.isArray(m.attachments) && (m.attachments as { name: string; storage_path?: string }[]).length > 0 && (
                      <p className="mt-1 text-xs text-muted">Attachments: {(m.attachments as { name: string; storage_path?: string }[]).map((a, i) => (
                        <span key={i}>{i > 0 ? ", " : ""}{a.storage_path && urls.get(a.storage_path) ? <a href={urls.get(a.storage_path) ?? undefined} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">{a.name}</a> : a.name}</span>
                      ))}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {canWork && (
              <ActionForm action={partnerClaimMessage} submitLabel="Send" className="mt-4 space-y-2" resetOnSuccess>
                <input type="hidden" name="claimId" value={claim.id} />
                <Field label="Write a message" htmlFor="cm-body">
                  <Textarea id="cm-body" name="body" rows={2} required className="min-h-16 text-sm" maxLength={4000} />
                </Field>
                <Checkbox name="internal" label="Internal note (hidden from the customer)" />
              </ActionForm>
            )}
          </Section>

          <Section title="Repairs and services" description="Approved partners from the network. Direct billing means the insurer settles the partner's invoice and the customer pays nothing upfront.">
            {jobs.length === 0 ? <Empty>No partner assigned yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {jobs.map((j) => (
                  <li key={j.id} className="rounded-xl border border-line px-4 py-3">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">{j.partner?.name ?? "Partner"} <span className="font-normal text-muted">· {humanize(j.kind)}{j.partner?.kind ? ` · ${SERVICE_PARTNER_KIND_LABELS[j.partner.kind as ServicePartnerKind] ?? j.partner.kind}` : ""}</span></span>
                      <Pill tone={CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.tone ?? "neutral"}>{CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.label ?? j.status}</Pill>
                    </p>
                    <p className="text-xs text-muted">{[j.partner?.address, j.partner?.phone, j.scheduled_for ? `scheduled ${formatDateTime(j.scheduled_for)}` : null, j.estimate != null ? `estimate ${formatGHS(Number(j.estimate))}` : null, j.direct_billing ? "direct billing" : "customer pays"].filter(Boolean).join(" · ")}</p>
                    {j.notes && <p className="mt-1 text-xs text-ink-2">{j.notes}</p>}
                    {canWork && !["completed", "cancelled"].includes(j.status) && (
                      <ActionForm action={partnerUpdateJob} submitLabel="Update" variant="outline" size="sm" inline className="mt-2">
                        <input type="hidden" name="claimId" value={claim.id} />
                        <input type="hidden" name="jobId" value={j.id} />
                        <label htmlFor={`js-${j.id}`} className="sr-only">Status</label>
                        <Select id={`js-${j.id}`} name="status" defaultValue={j.status} className="h-9 text-sm">
                          {Object.entries(CLAIM_JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </Select>
                        <Input name="notes" placeholder="Note (optional)" className="h-9 w-56 text-sm" maxLength={2000} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWork && !closed && (
              partners.length === 0 ? <p className="mt-3 text-xs text-muted">No approved partners in the directory yet. Platform staff add them under Service partners.</p> : (
                <ActionForm action={partnerAssignJob} submitLabel="Assign partner" variant="secondary" className="mt-4 rounded-xl border border-line p-4" resetOnSuccess>
                  <h3 className="font-semibold text-ink">Assign a service partner</h3>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Partner" htmlFor="job-partner" hint="★ = direct-bills this insurer">
                      <Select id="job-partner" name="servicePartnerId" className="h-10 text-sm">
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>{p.directBilling ? "★ " : ""}{p.name} · {SERVICE_PARTNER_KIND_LABELS[p.kind as ServicePartnerKind] ?? p.kind}{p.region ? ` · ${p.region}` : ""}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Job" htmlFor="job-kind">
                      <Select id="job-kind" name="kind" className="h-10 text-sm">
                        <option value="repair">Repair</option>
                        <option value="towing">Towing</option>
                        <option value="assessment">Assessment</option>
                        <option value="treatment">Treatment</option>
                        <option value="replacement">Replacement</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Estimate (GH₵)" htmlFor="job-est">
                      <Input id="job-est" name="estimate" type="number" min={0} step="0.01" className="h-10 text-sm" />
                    </Field>
                    <Field label="Scheduled for" htmlFor="job-when">
                      <Input id="job-when" name="scheduledFor" type="datetime-local" className="h-10 text-sm" />
                    </Field>
                  </div>
                  <Field label="Notes for the customer" htmlFor="job-notes">
                    <Textarea id="job-notes" name="notes" rows={2} className="min-h-14 text-sm" maxLength={2000} />
                  </Field>
                  <Checkbox name="directBilling" label="Direct billing — the insurer settles the partner's invoice; the customer pays nothing upfront" />
                </ActionForm>
              )
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

          <Section title="Customer journey" description="What the customer sees, with expected times.">
            <ol className="space-y-1.5 text-sm">
              {stages.map((s) => (
                <li key={s.key} className="flex items-start justify-between gap-2">
                  <span className={s.state === "upcoming" ? "text-muted" : "font-medium text-ink"}>{s.label}</span>
                  <span className={`text-right text-xs ${s.overdue ? "text-danger" : "text-muted"}`}>{s.at ? formatDateTime(s.at) : s.expectedBy ? `expected ${formatDateTime(s.expectedBy)}${s.overdue ? " · overdue" : ""}` : s.expectedLabel ?? ""}</span>
                </li>
              ))}
            </ol>
            {openRequests.length > 0 && <p className="mt-2 text-xs text-amber">{openRequests.length} open information request{openRequests.length === 1 ? "" : "s"}.</p>}
          </Section>

          {isInsurer && (
            <Section title="Fraud indicators" description="Automated checks for the claims team and platform staff. Never shown to the customer or the broker.">
              <p className="mb-3 flex items-center gap-2 text-sm">
                <Pill tone={FRAUD_STATUS_LABELS[fraudStatus].tone}>{FRAUD_STATUS_LABELS[fraudStatus].label}</Pill>
                <span className="text-muted">Score {fraudScore != null ? Number(fraudScore) : 0}/100</span>
              </p>
              {(flags ?? []).length === 0 ? <Empty>No indicators raised.</Empty> : (
                <ul className="space-y-2 text-sm">
                  {(flags ?? []).map((f) => {
                    const meta = FRAUD_KIND_LABELS[f.kind as FraudKind];
                    const details = (f.details ?? {}) as Record<string, unknown>;
                    return (
                      <li key={f.id} className={`rounded-xl border px-3 py-2.5 ${f.status === "cleared" ? "border-line opacity-70" : f.status === "confirmed" ? "border-danger/50 bg-danger-bg/40" : "border-amber/50 bg-amber-bg/30"}`}>
                        <p className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-ink">{meta?.label ?? humanize(f.kind)}</span>
                          <Pill tone={f.status === "cleared" ? "neutral" : f.status === "confirmed" ? "danger" : "wait"}>{humanize(f.status)}</Pill>
                        </p>
                        <p className="text-xs text-muted">{meta?.hint}</p>
                        {Object.keys(details).length > 0 && (
                          <p className="mt-1 text-xs text-ink-2">
                            {Object.entries(details).map(([k, v]) => `${humanize(k)}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}
                            {typeof details.other_claim_id === "string" && <> · <Link href={`/partner/claims/${details.other_claim_id}`} className="font-medium text-brand hover:underline">open other claim</Link></>}
                          </p>
                        )}
                        {f.reviewed_at && <p className="mt-1 text-xs text-muted">Reviewed {formatDateTime(f.reviewed_at)}{f.reviewed_by && members.get(f.reviewed_by) ? ` by ${members.get(f.reviewed_by)}` : ""}{f.review_note ? ` — ${f.review_note}` : ""}</p>}
                        {canAct && f.status === "open" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ActionForm action={partnerReviewFraudFlag} submitLabel="Clear" variant="outline" size="sm" inline>
                              <input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="flagId" value={f.id} /><input type="hidden" name="status" value="cleared" />
                            </ActionForm>
                            <ActionForm action={partnerReviewFraudFlag} submitLabel="Confirm fraud" variant="danger" size="sm" inline confirm="Confirm this indicator as fraud? The claim is marked as confirmed fraud for the claims team.">
                              <input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="flagId" value={f.id} /><input type="hidden" name="status" value="confirmed" />
                            </ActionForm>
                          </div>
                        )}
                        {canAct && f.status !== "open" && (
                          <ActionForm action={partnerReviewFraudFlag} submitLabel="Reopen" variant="outline" size="sm" inline className="mt-2">
                            <input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="flagId" value={f.id} /><input type="hidden" name="status" value="open" />
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canAct && (
                <ActionForm action={partnerRerunFraudChecks} submitLabel="Re-run checks" variant="outline" size="sm" inline className="mt-3">
                  <input type="hidden" name="claimId" value={claim.id} />
                </ActionForm>
              )}
            </Section>
          )}

          {claim.decision_at && (
            <Notice tone={claim.status === "rejected" ? "danger" : "ok"} title={`Decision: ${CLAIM_STATUS[claim.status === "paid" || claim.status === "closed" ? "approved" : claim.status].label}`}>
              {claim.decision_amount != null && <p>Amount: {formatGHS(Number(claim.decision_amount))}</p>}
              {claim.decision_note && <p>{claim.decision_note}</p>}
              <p className="text-xs">Recorded {formatDateTime(claim.decision_at)}{claim.decision_by && members.get(claim.decision_by) ? ` by ${members.get(claim.decision_by)}` : ""}</p>
            </Notice>
          )}

          {isBroker && <Notice tone="info" title="Only the insurer decides">Record delivery and broker steps from <Link href="/partner/service#claims" className="font-semibold underline">Service &amp; claims</Link>. Decisions and payment come from {orgs.get(claim.insurer_org_id) ?? "the insurer"}.</Notice>}

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
                    {fraudStatus !== "clear" && <p className="mb-3 rounded-lg bg-amber-bg px-3 py-2 text-xs text-amber">Review the fraud indicators before deciding.</p>}
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
