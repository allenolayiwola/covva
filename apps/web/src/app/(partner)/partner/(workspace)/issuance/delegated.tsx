import Link from "next/link";
import { EmptyState, Field, Input, Notice, Pill, StatusPill, Table, Td, Textarea, Th, THead } from "@im/ui";
import { POLICY_STATUS, formatDate, formatDateTime, humanize } from "@im/core";
import type { Row } from "@im/db";
import { can, ROLES, type PartnerContext } from "../../_lib/context";
import { getCategoryMap, getCustomers, nowMs, shortName } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { DocumentUpload } from "@/components/partner/document-upload";
import { Empty, KV, Section } from "@/components/partner/ui";
import { cancelDelegated, endorseDelegated, recordNicRegistration, recordPolicyDocuments } from "./actions";

const DOC_KINDS = [
  { value: "policy_schedule", label: "Policy schedule (replacement)" },
  { value: "certificate", label: "Certificate (replacement)" },
  { value: "endorsement", label: "Endorsement" },
  { value: "other", label: "Other" },
];

type Job = Row<"issuance_jobs">;
type Outcome = { outcome?: string; fits?: boolean; reason?: string; level?: string; referred_because?: string };
type Nic = { status?: string; reference?: string | null; provider?: string; submitted_at?: string };
type Doc = { kind: string; sha256: string; generated_at: string };

export function NicPill({ nic }: { nic: Nic | null | undefined }) {
  const s = nic?.status ?? "not_required";
  if (s === "registered") return <Pill tone="ok">NIC registered{nic?.reference ? ` · ${nic.reference}` : ""}</Pill>;
  if (s === "pending") return <Pill tone="wait">NIC registration pending{nic?.provider === "manual_handoff" ? " (your team)" : ""}</Pill>;
  if (s === "failed") return <Pill tone="danger">NIC registration failed</Pill>;
  return <Pill tone="neutral">NIC not required</Pill>;
}

export function JobStatusPill({ status }: { status: string }) {
  const tone = status === "review_window" ? "wait" : status === "issued" || status === "endorsed" ? "ok" : status === "cancelled" || status === "failed" ? "danger" : status === "referred" ? "info" : "neutral";
  return <Pill tone={tone}>{humanize(status)}</Pill>;
}

/** "Delegated issuance" tab: review-window queue, referred items with the rule outcome, NIC status. */
export async function DelegatedIssuance({ ctx }: { ctx: PartnerContext }) {
  const sb = ctx.supabase;
  const { data: jobs } = await sb.from("issuance_jobs").select("*").eq("insurer_org_id", ctx.orgId).order("updated_at", { ascending: false }).limit(200);
  const all = (jobs ?? []) as Job[];
  const policyIds = all.map((j) => j.policy_id);
  const [{ data: policies }, cats] = await Promise.all([
    policyIds.length ? sb.from("policies").select("id, internal_reference, policy_number, status, customer_id, category_id, cover_start, cover_end, premium, request_id, sticker_number, verification_code").in("id", policyIds) : Promise.resolve({ data: [] as Pick<Row<"policies">, "id" | "internal_reference" | "policy_number" | "status" | "customer_id" | "category_id" | "cover_start" | "cover_end" | "premium" | "request_id" | "sticker_number" | "verification_code">[] }),
    getCategoryMap(),
  ]);
  const polOf = new Map((policies ?? []).map((p) => [p.id, p]));
  const customers = await getCustomers(ctx, (policies ?? []).map((p) => p.customer_id));
  const canAct = can(ctx, ROLES.underwrite);
  const now = nowMs();
  const review = all.filter((j) => j.status === "review_window" && (!j.review_until || new Date(j.review_until).getTime() > now));
  const referred = all.filter((j) => j.status === "referred" && polOf.get(j.policy_id)?.status === "pending_issuance");
  const pendingNic = all.filter((j) => (j.nic_registration as Nic | null)?.status === "pending" && !review.some((r) => r.id === j.id));
  const recent = all.filter((j) => !review.includes(j) && !referred.includes(j)).slice(0, 40);

  return (
    <div className="space-y-6">
      <Notice tone="info" title="Delegated issuance (Level 2)">
        For products that fit your approved underwriting rules, Covva issues instantly on your behalf using your policy-number block and approved templates. You see every issued policy here and can endorse or cancel it within the review window. Risks outside the rules are referred to your queue with the rule outcome. <Link href="/partner/issuance/number-blocks" className="font-semibold text-brand hover:underline">Manage number blocks</Link>
      </Notice>

      <Section title="Review window" description="Issued on your behalf. Endorse (notes, replacement documents) or cancel with a reason before the window closes; cancelling refunds the premium.">
        {review.length === 0 ? <Empty>No delegated policies in their review window.</Empty> : (
          <div className="space-y-4">
            {review.map((j) => {
              const p = polOf.get(j.policy_id);
              if (!p) return null;
              const outcome = j.underwriting_outcome as Outcome | null;
              const docs = (j.documents ?? []) as unknown as Doc[];
              const nic = j.nic_registration as Nic | null;
              return (
                <div key={j.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{p.policy_number ?? p.internal_reference} · {shortName(customers.get(p.customer_id))}</p>
                      <p className="text-xs text-muted">{cats.get(p.category_id)?.name} · cover {formatDate(p.cover_start)} – {formatDate(p.cover_end)} · review until <span className="font-medium text-amber">{formatDateTime(j.review_until)}</span></p>
                    </div>
                    <div className="flex flex-wrap gap-1.5"><StatusPill meta={POLICY_STATUS[p.status]} /><JobStatusPill status={j.status} /><NicPill nic={nic} /></div>
                  </div>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <KV label="Rules">{outcome?.reason ?? "All rules accepted."}</KV>
                      <KV label="Documents">{docs.length ? docs.map((d) => <Pill key={d.kind} tone="ok" className="mr-1">{humanize(d.kind)}</Pill>) : "—"}</KV>
                      {docs.length > 0 && <p className="mt-1 text-[11px] text-subtle">SHA-256 {docs.map((d) => `${d.kind}: ${d.sha256.slice(0, 12)}…`).join(" · ")}</p>}
                      {j.notes && <KV label="Notes"><span className="whitespace-pre-line">{j.notes}</span></KV>}
                      {nic?.status === "pending" && canAct && (
                        <ActionForm action={recordNicRegistration} submitLabel="Record NIC registration" className="mt-3 space-y-2">
                          <input type="hidden" name="policyId" value={p.id} />
                          <Field label="NIC motor database reference / sticker number" htmlFor={`nic-${j.id}`}>
                            <Input id={`nic-${j.id}`} name="reference" required minLength={3} className="h-10 text-sm" placeholder="e.g. MID-2026-000123" />
                          </Field>
                        </ActionForm>
                      )}
                    </div>
                    {canAct ? (
                      <div className="space-y-3">
                        <ActionForm action={endorseDelegated} submitLabel="Record endorsement" className="space-y-2">
                          <input type="hidden" name="policyId" value={p.id} />
                          <Field label="Endorsement notes" htmlFor={`en-${j.id}`}>
                            <Textarea id={`en-${j.id}`} name="notes" rows={2} required className="min-h-16 text-sm" placeholder="What changed and why" />
                          </Field>
                          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="regenerate" className="size-4" /> Regenerate the documents</label>
                        </ActionForm>
                        <DocumentUpload customerId={p.customer_id} scope="policies" kinds={DOC_KINDS} hidden={{ policyId: p.id }} action={recordPolicyDocuments} label="Upload replacement documents" />
                        <details className="rounded-xl border border-line p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-danger">Cancel within review window</summary>
                          <ActionForm action={cancelDelegated} submitLabel="Cancel policy and refund" variant="danger" className="mt-3 space-y-3" confirm="Cancel this policy? Cover ends now and the premium is refunded to the customer.">
                            <input type="hidden" name="policyId" value={p.id} />
                            <Field label="Reason" htmlFor={`cr-${j.id}`}>
                              <Textarea id={`cr-${j.id}`} name="reason" rows={2} required className="min-h-16 text-sm" />
                            </Field>
                          </ActionForm>
                        </details>
                      </div>
                    ) : <p className="text-sm text-muted">Underwriters endorse or cancel delegated policies.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Referred to you" description="Outside the delegated rules (or no usable number block). Issue or decline them in the insurer queue tab — the rule outcome is shown so you know why.">
        {referred.length === 0 ? <Empty>Nothing referred.</Empty> : (
          <Table>
            <THead><tr><Th>Policy</Th><Th>Customer</Th><Th>Line</Th><Th>Rule outcome</Th><Th>Referred</Th></tr></THead>
            <tbody>
              {referred.map((j) => {
                const p = polOf.get(j.policy_id);
                const o = j.underwriting_outcome as Outcome | null;
                return (
                  <tr key={j.id}>
                    <Td><Link href="/partner/issuance" className="font-semibold text-ink hover:text-brand">{p?.internal_reference ?? "—"}</Link></Td>
                    <Td>{p ? shortName(customers.get(p.customer_id)) : "—"}</Td>
                    <Td>{p ? cats.get(p.category_id)?.name : "—"}</Td>
                    <Td className="max-w-md text-xs"><Pill tone={o?.outcome === "decline" ? "danger" : "wait"}>{humanize(o?.outcome ?? "refer")}</Pill> <span className="text-muted">{o?.referred_because ?? o?.reason ?? j.error ?? ""}</span></Td>
                    <Td className="text-xs text-muted">{formatDateTime(j.updated_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {pendingNic.length > 0 && (
        <Section title="NIC motor database registrations" description="Motor policies waiting for your team to register them on the NIC motor insurance database. Record the reference once done.">
          <div className="space-y-3">
            {pendingNic.map((j) => {
              const p = polOf.get(j.policy_id);
              if (!p) return null;
              return (
                <div key={j.id} className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line p-3">
                  <div>
                    <p className="font-semibold text-ink">{p.policy_number ?? p.internal_reference} · {shortName(customers.get(p.customer_id))}</p>
                    <p className="text-xs text-muted">Cover {formatDate(p.cover_start)} – {formatDate(p.cover_end)}</p>
                  </div>
                  {canAct && (
                    <ActionForm action={recordNicRegistration} submitLabel="Record" className="flex items-end gap-2">
                      <input type="hidden" name="policyId" value={p.id} />
                      <Field label="NIC reference" htmlFor={`nicp-${j.id}`}>
                        <Input id={`nicp-${j.id}`} name="reference" required minLength={3} className="h-10 text-sm" />
                      </Field>
                    </ActionForm>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="All issuance jobs" description="Every policy created after payment, how it was issued and its NIC registration status.">
        {recent.length === 0 ? (
          <EmptyState title="No issuance jobs yet" body="Jobs appear here as soon as a customer's payment is confirmed." />
        ) : (
          <Table>
            <THead><tr><Th>Policy</Th><Th>Mode</Th><Th>Status</Th><Th>NIC registration</Th><Th>Documents</Th><Th>Updated</Th></tr></THead>
            <tbody>
              {recent.map((j) => {
                const p = polOf.get(j.policy_id);
                const docs = (j.documents ?? []) as unknown as Doc[];
                return (
                  <tr key={j.id}>
                    <Td><span className="font-semibold text-ink">{p?.policy_number ?? p?.internal_reference ?? "—"}</span><p className="text-xs text-muted">{p ? shortName(customers.get(p.customer_id)) : ""}</p></Td>
                    <Td>{humanize(j.mode)}</Td>
                    <Td><JobStatusPill status={j.status} />{j.error && <p className="mt-1 max-w-xs text-xs text-danger">{j.error}</p>}</Td>
                    <Td><NicPill nic={j.nic_registration as Nic | null} /></Td>
                    <Td className="text-xs">{docs.length ? docs.map((d) => humanize(d.kind)).join(", ") : "—"}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(j.updated_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
