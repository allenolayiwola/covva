import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Notice, PageHeader, Pill, Select, Table, Td, Th, THead, Textarea } from "@im/ui";
import { formatDate, formatDateTime, humanize } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../_lib/context";
import { getCategoryMap, getOrgNames } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";
import { decideAppointment, requestAppointment, requestAppointmentWithLetter } from "./actions";
import { AppointmentLetterForm } from "./letter-form";

export const metadata: Metadata = { title: "Appointments" };

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<><PageSkeleton stats={0} /></>}>
      <Appointments />
    </Suspense>
  );
}

const TONE = { pending: "wait", admin_review: "info", approved: "ok", declined: "neutral", revoked: "danger" } as const;

async function Appointments() {
  const ctx = await getPartnerContext();
  return ctx.kind === "insurer" ? <InsurerView ctx={ctx} /> : <BrokerView ctx={ctx} />;
}

// ---------------------------------------------------------------------------
// Broker: browse live insurers, request appointments per line, letters for insurers not on Covva
// ---------------------------------------------------------------------------
async function BrokerView({ ctx }: { ctx: PartnerContext }) {
  const sb = ctx.supabase;
  const admin = can(ctx, ROLES.orgAdmin);
  const [{ data: insurers }, { data: appts }, { data: requests }, cats] = await Promise.all([
    sb.from("organizations").select("id, name, region, nic_licence_class, website").eq("type", "insurer").eq("status", "active").order("name"),
    sb.from("insurer_broker_appointments").select("id, insurer_org_id, category_id, active, starts_on, ends_on").eq("broker_org_id", ctx.orgId),
    sb.from("appointment_requests").select("*").eq("broker_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(200),
    getCategoryMap(),
  ]);
  const catList = [...cats.values()];
  const activeAppt = new Set((appts ?? []).filter((a) => a.active).map((a) => `${a.insurer_org_id}:${a.category_id ?? "*"}`));
  const open = new Map((requests ?? []).filter((r) => r.status === "pending" && r.insurer_org_id).map((r) => [`${r.insurer_org_id}:${r.category_id}`, r]));
  const names = await getOrgNames(ctx, (requests ?? []).map((r) => r.insurer_org_id));

  return (
    <>
      <PageHeader title="Appointments" description="Only approved appointments make you eligible for an insurer's orders in that line. Insurers approve requests in their Covva portal; letters for insurers not yet on Covva are verified by Covva." />
      {!admin && <Notice tone="info" className="mb-6">Only owners and admins can request appointments. You can see their status.</Notice>}
      <div className="space-y-6">
        <Section title="Insurers live on Covva" description="Request an appointment per product line. The insurer decides; you are notified either way.">
          {(insurers ?? []).length === 0 ? (
            <Empty>No insurers are live yet.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Insurer</Th><Th>Lines</Th>{admin && <Th>Request</Th>}</tr></THead>
              <tbody>
                {(insurers ?? []).map((i) => {
                  const lines = catList.map((c) => {
                    const key = `${i.id}:${c.id}`;
                    const state = activeAppt.has(key) || activeAppt.has(`${i.id}:*`) ? "appointed" : open.has(key) ? "pending" : "none";
                    return { c, state };
                  });
                  const available = lines.filter((l) => l.state === "none");
                  return (
                    <tr key={i.id} className="align-top">
                      <Td>
                        <p className="font-semibold text-ink">{i.name}</p>
                        <p className="text-xs text-muted">{[i.nic_licence_class ? humanize(i.nic_licence_class) : null, i.region].filter(Boolean).join(" · ")}</p>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {lines.filter((l) => l.state !== "none").map((l) => (
                            <Pill key={l.c.id} tone={l.state === "appointed" ? "ok" : "wait"}>{l.c.name}{l.state === "pending" ? " · pending" : ""}</Pill>
                          ))}
                          {lines.every((l) => l.state === "none") && <span className="text-xs text-subtle">No appointments yet</span>}
                        </div>
                      </Td>
                      {admin && (
                        <Td>
                          {available.length ? (
                            <ActionForm action={requestAppointment} submitLabel="Request" inline>
                              <input type="hidden" name="insurerOrgId" value={i.id} />
                              <label htmlFor={`cat-${i.id}`} className="sr-only">Product line</label>
                              <Select id={`cat-${i.id}`} name="categoryId" className="h-9 w-44 text-sm" defaultValue={available[0]!.c.id}>
                                {available.map((l) => <option key={l.c.id} value={l.c.id}>{l.c.name}</option>)}
                              </Select>
                            </ActionForm>
                          ) : (
                            <span className="text-xs text-subtle">All lines requested</span>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>

        {admin && (
          <Section title="Insurer not on Covva?" description="Upload the insurer's appointment letter. Covva verifies it and the partnerships team invites the insurer (this also suggests the insurer to Covva).">
            <AppointmentLetterForm brokerOrgId={ctx.orgId} categories={catList.map((c) => ({ id: c.id, name: c.name }))} action={requestAppointmentWithLetter} />
          </Section>
        )}

        <Section title="Your requests" description="Every request and its outcome. Revoked appointments end your eligibility for new orders immediately.">
          {(requests ?? []).length === 0 ? (
            <Empty>No appointment requests yet.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Insurer</Th><Th>Line</Th><Th>Status</Th><Th>Requested</Th><Th>Decision</Th></tr></THead>
              <tbody>
                {(requests ?? []).map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium text-ink">{r.insurer_org_id ? names.get(r.insurer_org_id) ?? "Insurer" : `${r.proposed_insurer_name} (not on Covva)`}</Td>
                    <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                    <Td><Pill tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{humanize(r.status)}</Pill></Td>
                    <Td className="text-xs text-muted">{formatDateTime(r.created_at)}</Td>
                    <Td className="text-xs text-muted">{r.decided_at ? `${formatDateTime(r.decided_at)}${r.decision_note ? ` · ${r.decision_note}` : ""}` : r.status === "admin_review" ? "Covva is verifying the letter" : "Awaiting the insurer"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Insurer: approve / decline requests, revoke appointments (owner/admin)
// ---------------------------------------------------------------------------
async function InsurerView({ ctx }: { ctx: PartnerContext }) {
  const sb = ctx.supabase;
  const admin = can(ctx, ROLES.orgAdmin);
  const [{ data: requests }, { data: appts }, cats] = await Promise.all([
    sb.from("appointment_requests").select("*").eq("insurer_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(300),
    sb.from("insurer_broker_appointments").select("id, broker_org_id, category_id, active, starts_on, ends_on").eq("insurer_org_id", ctx.orgId).eq("active", true),
    getCategoryMap(),
  ]);
  const all = requests ?? [];
  const pending = all.filter((r) => r.status === "pending");
  const approved = all.filter((r) => r.status === "approved");
  const history = all.filter((r) => r.status !== "pending" && r.status !== "approved");
  const names = await getOrgNames(ctx, [...all.map((r) => r.broker_org_id), ...(appts ?? []).map((a) => a.broker_org_id)]);
  const requestFor = new Map(approved.map((r) => [`${r.broker_org_id}:${r.category_id}`, r]));

  const decide = (id: string, decision: "approve" | "decline" | "revoke") => (
    <ActionForm
      action={decideAppointment}
      submitLabel={decision === "approve" ? "Approve" : decision === "decline" ? "Decline" : "Revoke"}
      variant={decision === "approve" ? "primary" : "outline"}
      inline
      confirm={decision === "revoke" ? "Revoke this appointment? The broker loses eligibility for new orders in this line immediately." : undefined}
    >
      <input type="hidden" name="requestId" value={id} />
      <input type="hidden" name="decision" value={decision} />
      {decision !== "approve" && (
        <>
          <label htmlFor={`note-${decision}-${id}`} className="sr-only">Note to the broker</label>
          <Textarea id={`note-${decision}-${id}`} name="note" rows={1} placeholder="Note to the broker (optional)" className="min-h-9 w-56 text-sm" />
        </>
      )}
    </ActionForm>
  );

  return (
    <>
      <PageHeader title="Broker appointments" description="Brokers ask to be appointed per product line. Approving makes them eligible for your orders in that line; revoking removes eligibility immediately." />
      {!admin && <Notice tone="info" className="mb-6">Only owners and admins decide appointments. You can see their status.</Notice>}
      <div className="space-y-6">
        <Section title={`Requests awaiting your decision (${pending.length})`}>
          {pending.length === 0 ? (
            <Empty>No pending requests.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Broker</Th><Th>Line</Th><Th>Requested</Th>{admin && <Th>Decision</Th>}</tr></THead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} className="align-top">
                    <Td className="font-medium text-ink">{names.get(r.broker_org_id) ?? "Broker"}</Td>
                    <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(r.created_at)}</Td>
                    {admin && <Td><div className="flex flex-wrap gap-2">{decide(r.id, "approve")}{decide(r.id, "decline")}</div></Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="Active appointments" description="Brokers currently eligible to place your products, per line.">
          {(appts ?? []).length === 0 ? (
            <Empty>No active appointments.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Broker</Th><Th>Line</Th><Th>Since</Th>{admin && <Th>Manage</Th>}</tr></THead>
              <tbody>
                {(appts ?? []).map((a) => {
                  const req = a.category_id ? requestFor.get(`${a.broker_org_id}:${a.category_id}`) : undefined;
                  return (
                    <tr key={a.id} className="align-top">
                      <Td className="font-medium text-ink">{names.get(a.broker_org_id) ?? "Broker"}</Td>
                      <Td>{a.category_id ? cats.get(a.category_id)?.name ?? "—" : "All lines"}</Td>
                      <Td className="text-xs text-muted">{formatDate(a.starts_on)}</Td>
                      {admin && <Td>{req ? decide(req.id, "revoke") : <span className="text-xs text-subtle">Set by Covva — ask support to change</span>}</Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title="History">
          {history.length === 0 ? (
            <Empty>No decided requests yet.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Broker</Th><Th>Line</Th><Th>Status</Th><Th>Decided</Th></tr></THead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium text-ink">{names.get(r.broker_org_id) ?? "Broker"}</Td>
                    <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                    <Td><Pill tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{humanize(r.status)}</Pill></Td>
                    <Td className="text-xs text-muted">{r.decided_at ? formatDateTime(r.decided_at) : "—"}{r.decision_note ? ` · ${r.decision_note}` : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
