import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, Field, Notice, PageHeader, Pill, Select, StatCard, StatusPill, Table, Td, Textarea, Th, THead } from "@im/ui";
import { CLAIM_DISCLAIMER, CLAIM_STATUS, COMPLAINT_STATUS, OPEN_REQUEST_STATUSES, REQUEST_STATUS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { TYPE_LABEL, getCategoryMap, getCustomers, getOrgNames, shortName } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { RealtimeRefresh } from "@/components/partner/realtime-refresh";
import { DueCell, Empty, PageSkeleton, Section, slaDaysLeft } from "@/components/partner/ui";
import { brokerClaimStatus, complaintAction, deliverClaimEvidence } from "./actions";

export const metadata: Metadata = { title: "Service & claims" };

export default function ServicePage() {
  return (
    <>
      <PageHeader title="Service & claims" description="Help customers with claims, changes and complaints. The insurer decides claims; you keep things moving." />
      <Suspense fallback={<PageSkeleton />}>
        <Service />
      </Suspense>
    </>
  );
}

const CLOSED_CLAIM = ["paid", "closed", "withdrawn", "rejected"];

async function Service() {
  const ctx = await requireKind("broker");
  const sb = ctx.supabase;
  const [{ data: claims }, { data: service }, { data: complaints }] = await Promise.all([
    sb.from("claims").select("id, reference, status, customer_id, insurer_org_id, policy_id, incident_type, incident_at, amount_claimed, decision_amount, decision_note, reported_at, created_at").eq("broker_org_id", ctx.orgId).neq("status", "draft").order("created_at", { ascending: false }).limit(300),
    sb.from("requests").select("id, reference, type, status, customer_id, category_id, due_at, created_at").eq("broker_org_id", ctx.orgId).in("type", ["endorsement", "switch", "service"]).in("status", OPEN_REQUEST_STATUSES).order("due_at", { ascending: true, nullsFirst: false }),
    sb.from("complaints").select("*").eq("owner_org_id", ctx.orgId).order("due_at", { ascending: true }).limit(300),
  ]);
  const claimIds = (claims ?? []).map((c) => c.id);
  const [customers, insurers, cats, { data: claimDocs }, { data: insurerEvents }] = await Promise.all([
    getCustomers(ctx, [...(claims ?? []).map((c) => c.customer_id), ...(service ?? []).map((r) => r.customer_id), ...(complaints ?? []).map((c) => c.customer_id)]),
    getOrgNames(ctx, (claims ?? []).map((c) => c.insurer_org_id)),
    getCategoryMap(),
    claimIds.length ? sb.from("documents").select("claim_id, delivered_to_insurer_at").in("claim_id", claimIds) : Promise.resolve({ data: [] as { claim_id: string | null; delivered_to_insurer_at: string | null }[] }),
    claimIds.length ? sb.from("claim_events").select("claim_id").in("claim_id", claimIds).eq("actor_party", "insurer") : Promise.resolve({ data: [] as { claim_id: string }[] }),
  ]);
  const insurerActed = new Set((insurerEvents ?? []).map((e) => e.claim_id));
  const canWork = can(ctx, ROLES.brokerWork);
  const openClaims = (claims ?? []).filter((c) => !CLOSED_CLAIM.includes(c.status));
  const openComplaints = (complaints ?? []).filter((c) => !["resolved", "closed"].includes(c.status));

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Claims assisting" value={openClaims.length} />
        <StatCard label="Awaiting delivery to insurer" value={(claims ?? []).filter((c) => c.status === "reported").length} tone="warn" />
        <StatCard label="Changes & service requests" value={(service ?? []).length} />
        <StatCard label="Open complaints" value={openComplaints.length} tone={openComplaints.some((c) => (slaDaysLeft(c.due_at) ?? 99) <= 3) ? "warn" : "default"} />
      </div>

      <div className="mt-6 space-y-6">
        <Section id="claims" title="Claims" description={CLAIM_DISCLAIMER} actions={<RealtimeRefresh table="claims" filter={`broker_org_id=eq.${ctx.orgId}`} channel={`claims-${ctx.orgId}`} />}>
          {(claims ?? []).length === 0 ? <Empty>No claims reported by your customers yet.</Empty> : (
            <div className="space-y-3">
              {(claims ?? []).map((c) => {
                const docs = (claimDocs ?? []).filter((d) => d.claim_id === c.id);
                const undelivered = docs.filter((d) => !d.delivered_to_insurer_at).length;
                const closed = CLOSED_CLAIM.includes(c.status);
                const brokerMayAssess = !insurerActed.has(c.id) && ["delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"].includes(c.status);
                return (
                  <details key={c.id} className="group rounded-xl border border-line bg-white" open={c.status === "reported"}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="font-semibold text-ink">{c.reference} · {shortName(customers.get(c.customer_id))}</p>
                        <p className="text-xs text-muted">{c.incident_type} · {insurers.get(c.insurer_org_id) ?? "Insurer"} · reported {formatDate(c.reported_at ?? c.created_at)}{c.amount_claimed ? ` · claimed ${formatGHS(Number(c.amount_claimed))}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {undelivered > 0 && <Pill tone="wait">{undelivered} doc{undelivered === 1 ? "" : "s"} not delivered</Pill>}
                        <StatusPill meta={CLAIM_STATUS[c.status]} />
                      </div>
                    </summary>
                    <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
                      {c.decision_note && <p className="text-ink-2"><span className="font-medium">Insurer decision:</span> {c.decision_note}{c.decision_amount ? ` (${formatGHS(Number(c.decision_amount))})` : ""}</p>}
                      <p><Link href={`/partner/claims/${c.id}`} className="font-medium text-brand hover:underline">Open claim workspace</Link> <span className="text-xs text-muted">· thread, information requests, repairs and services</span></p>
                      {closed ? <p className="text-muted">This claim is {CLAIM_STATUS[c.status].label.toLowerCase()}.</p> : !canWork ? null : (
                        <div className="flex flex-wrap items-start gap-3">
                          {c.status === "reported" && (
                            <ActionForm action={brokerClaimStatus} submitLabel="Confirm delivered to insurer" inline>
                              <input type="hidden" name="claimId" value={c.id} /><input type="hidden" name="to" value="delivered_to_insurer" />
                            </ActionForm>
                          )}
                          {undelivered > 0 && (
                            <ActionForm action={deliverClaimEvidence} submitLabel="Mark evidence delivered" variant="outline" inline>
                              <input type="hidden" name="claimId" value={c.id} />
                            </ActionForm>
                          )}
                          {brokerMayAssess && (
                            <ActionForm action={brokerClaimStatus} submitLabel="Record update" variant="secondary" className="w-full max-w-xl space-y-2">
                              <input type="hidden" name="claimId" value={c.id} />
                              <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
                                <Field label="Insurer told us" htmlFor={`cs-${c.id}`}>
                                  <Select id={`cs-${c.id}`} name="to" className="h-10 text-sm">
                                    <option value="acknowledged">Acknowledged</option>
                                    <option value="under_assessment">Under assessment</option>
                                    <option value="info_requested">More information needed</option>
                                  </Select>
                                </Field>
                                <Field label="Note for the customer" htmlFor={`cn-${c.id}`}>
                                  <Textarea id={`cn-${c.id}`} name="note" rows={1} className="min-h-10 text-sm" />
                                </Field>
                              </div>
                            </ActionForm>
                          )}
                          {insurerActed.has(c.id) && <p className="text-xs text-muted">The insurer is updating this claim directly.</p>}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Changes, switches and service requests" description="Switch requests start a review — existing cover is never cancelled before the replacement is accepted, paid and effective.">
          {(service ?? []).length === 0 ? <Empty>No open service requests.</Empty> : (
            <Table>
              <THead><tr><Th>Request / customer</Th><Th>Type</Th><Th>Status</Th><Th>Next response</Th></tr></THead>
              <tbody>
                {(service ?? []).map((r) => (
                  <tr key={r.id}>
                    <Td><Link href={`/partner/requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference} · {shortName(customers.get(r.customer_id))}</Link><p className="text-xs text-muted">{cats.get(r.category_id)?.name}</p></Td>
                    <Td>{TYPE_LABEL[r.type]}</Td>
                    <Td><StatusPill meta={REQUEST_STATUS[r.status]} /></Td>
                    <Td><DueCell dueAt={r.due_at} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section id="complaints" title="Complaints" description="Acknowledge promptly and resolve within 14 days, or escalate to the NIC process.">
          {(complaints ?? []).length === 0 ? <Empty>No complaints. Keep it that way.</Empty> : (
            <div className="space-y-3">
              {(complaints ?? []).map((c) => {
                const left = slaDaysLeft(c.due_at);
                const open = !["resolved", "closed"].includes(c.status);
                return (
                  <details key={c.id} className="rounded-xl border border-line bg-white" open={c.status === "open"}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="font-semibold text-ink">{c.reference} · {c.subject}</p>
                        <p className="text-xs text-muted">{shortName(customers.get(c.customer_id))} · {humanize(c.category)} · against {c.against_party} · filed {formatDateTime(c.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {open && left !== null && <Pill tone={left < 0 ? "danger" : left <= 3 ? "wait" : "neutral"}>{left < 0 ? `${-left} days over SLA` : `${left} days left`}</Pill>}
                        <StatusPill meta={COMPLAINT_STATUS[c.status]} />
                      </div>
                    </summary>
                    <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
                      <p className="whitespace-pre-wrap text-ink-2">{c.description}</p>
                      {c.desired_outcome && <p className="text-muted"><span className="font-medium text-ink-2">Customer would like:</span> {c.desired_outcome}</p>}
                      {c.outcome && <Notice tone={c.status === "escalated_nic" ? "danger" : "ok"} title="Outcome">{c.outcome}</Notice>}
                      {open && canWork && (
                        <div className="flex flex-wrap items-start gap-2">
                          {c.status === "open" && <OpButton id={c.id} op="acknowledge" label="Acknowledge" />}
                          {["open", "acknowledged"].includes(c.status) && <OpButton id={c.id} op="investigate" label="Start investigation" variant="secondary" />}
                          <ActionForm action={complaintAction} submitLabel="Resolve" className="w-full space-y-2">
                            <input type="hidden" name="complaintId" value={c.id} /><input type="hidden" name="op" value="resolve" />
                            <Field label="Outcome for the customer" htmlFor={`co-${c.id}`}>
                              <Textarea id={`co-${c.id}`} name="text" rows={2} className="min-h-16 text-sm" placeholder="What happened, what we've done and what happens next." />
                            </Field>
                          </ActionForm>
                          {c.status !== "escalated_nic" && (
                            <ActionForm action={complaintAction} submitLabel="Escalate to NIC" variant="outline" className="w-full space-y-2" confirm="Escalate this complaint to the National Insurance Commission process?">
                              <input type="hidden" name="complaintId" value={c.id} /><input type="hidden" name="op" value="escalate" />
                              <Field label="Reason for escalation" htmlFor={`ce-${c.id}`}>
                                <Textarea id={`ce-${c.id}`} name="text" rows={1} className="min-h-10 text-sm" />
                              </Field>
                            </ActionForm>
                          )}
                        </div>
                      )}
                      {c.status === "resolved" && canWork && <OpButton id={c.id} op="close" label="Close complaint" variant="ghost" />}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </Section>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

function OpButton({ id, op, label, variant = "primary" }: { id: string; op: string; label: string; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <ActionForm action={complaintAction} submitLabel={label} variant={variant} inline>
      <input type="hidden" name="complaintId" value={id} /><input type="hidden" name="op" value={op} />
    </ActionForm>
  );
}
