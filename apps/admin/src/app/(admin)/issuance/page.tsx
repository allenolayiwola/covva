import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock, Pagination, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { retryIssuanceJob } from "./actions";

export default function IssuancePage({ searchParams }: PageProps<"/issuance">) {
  return (
    <>
      <PageHeader
        title="Issuance"
        description="Every policy created after payment: delegated (Covva issues on the insurer's behalf within its rules), insurer portal (Level 1 queue) or API adapter. SLA timers escalate from insurer contacts to Covva operations; on a final breach the customer chooses a refund or re-route."
      />
      <Suspense fallback={<LoadingBlock label="Loading issuance…" />}>
        <Issuance searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const JOB_STATUSES = ["queued", "generating", "issued", "referred", "review_window", "endorsed", "cancelled", "failed"] as const;
const tone = (s: string) => (s === "failed" || s === "cancelled" ? "danger" : s === "issued" || s === "endorsed" ? "ok" : s === "review_window" ? "wait" : s === "referred" ? "info" : "neutral");

async function Issuance({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const mode = sp(params, "mode");
  const insurer = sp(params, "insurer");
  const canAct = can(staff.roles, "operations");

  let jobs = supabase
    .from("issuance_jobs")
    .select("id, policy_id, request_id, insurer_org_id, mode, status, underwriting_outcome, review_until, documents, nic_registration, error, attempts, updated_at, policy:policies!issuance_jobs_policy_id_fkey(policy_number, internal_reference, status, category_id)", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (status) jobs = jobs.eq("status", status);
  if (mode) jobs = jobs.eq("mode", mode);
  if (insurer) jobs = jobs.eq("insurer_org_id", insurer);

  const [{ data: rows, count, error }, { data: timers }, { data: counts }] = await Promise.all([
    jobs,
    supabase.from("sla_timers").select("id, subject_type, subject_id, insurer_org_id, broker_org_id, started_at, due_at, escalation_level, escalated_at, breached_at").is("resolved_at", null).order("due_at").limit(200),
    supabase.from("issuance_jobs").select("status").in("status", ["failed", "review_window", "referred", "queued"]),
  ]);
  const tally = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const openTimers = timers ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="In review window" value={tally("review_window")} hint="Delegated policies the insurer can still endorse or cancel" />
        <Kpi label="Referred" value={tally("referred")} hint="Outside the delegated rules; in the insurer's L1 queue" />
        <Kpi label="Queued" value={tally("queued")} hint="Waiting for the insurer or an API adapter" />
        <Kpi label="Failed" value={tally("failed")} hint="Retry from the table below" tone={tally("failed") ? "danger" : undefined} />
      </div>

      <Panel title="SLA timers" description={`${openTimers.length} open timer${openTimers.length === 1 ? "" : "s"}. Level 1 = insurer contacts notified at due; 2 = Covva operations at due + 50%; 3 = final breach at 2× due (customer chooses refund or re-route).`}>
        {openTimers.length === 0 ? <p className="text-sm text-muted">No open SLA timers.</p> : (
          <Table>
            <THead><tr><Th>Subject</Th><Th>Insurer</Th><Th>Broker</Th><Th>Started</Th><Th>Due</Th><Th>Escalation</Th></tr></THead>
            <tbody>
              {openTimers.map((t) => (
                <tr key={t.id} className={t.escalation_level >= 3 ? "bg-danger-bg/40" : t.escalation_level > 0 ? "bg-amber-bg/40" : undefined}>
                  <Td>
                    <span className="font-medium text-ink">{t.subject_type}</span>
                    <p className="font-mono text-[11px] text-muted">{t.subject_id}</p>
                  </Td>
                  <Td>{t.insurer_org_id ? <Link href={`/organisations/${t.insurer_org_id}`} className="hover:text-brand">{orgs.get(t.insurer_org_id)?.name ?? "—"}</Link> : "—"}</Td>
                  <Td>{t.broker_org_id ? orgs.get(t.broker_org_id)?.name ?? "—" : "—"}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(t.started_at)}</Td>
                  <Td className="text-xs">{formatDateTime(t.due_at)}</Td>
                  <Td>
                    {t.escalation_level === 0 ? <Pill tone="ok">On time</Pill> : t.escalation_level === 1 ? <Pill tone="wait">Level 1 · insurer</Pill> : t.escalation_level === 2 ? <Pill tone="wait">Level 2 · Covva ops</Pill> : <Pill tone="danger">Final breach · customer choice</Pill>}
                    {t.breached_at && <p className="text-[11px] text-muted">Breached {formatDateTime(t.breached_at)}</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div>
        <FilterBar action="/issuance">
          <FilterSelect name="status" label="Status" value={status} options={JOB_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
          <FilterSelect name="mode" label="Mode" value={mode} options={[{ value: "delegated", label: "Delegated (L2)" }, { value: "insurer_portal", label: "Insurer portal (L1)" }, { value: "api", label: "API (L3)" }]} />
          <FilterSelect name="insurer" label="Insurer" value={insurer} options={[...orgs.values()].filter((o) => o.type === "insurer").map((o) => ({ value: o.id, label: o.name }))} />
        </FilterBar>
        <ReadOnlyBanner show={!canAct} />
        {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
        <Table>
          <THead><tr><Th>Policy</Th><Th>Insurer</Th><Th>Line</Th><Th>Mode</Th><Th>Status</Th><Th>Rules / error</Th><Th>NIC</Th><Th>Docs</Th><Th>Updated</Th><Th /></tr></THead>
          <tbody>
            {(rows ?? []).map((j) => {
              const p = j.policy as unknown as { policy_number: string | null; internal_reference: string; status: string; category_id: string } | null;
              const o = (j.underwriting_outcome ?? {}) as { outcome?: string; reason?: string; referred_because?: string; level?: string };
              const nic = (j.nic_registration ?? {}) as { status?: string; reference?: string | null };
              const docs = (j.documents ?? []) as unknown as { kind: string }[];
              return (
                <tr key={j.id} className="align-top hover:bg-mist/60">
                  <Td>
                    <Link href={`/policies/${j.policy_id}`} className="font-semibold text-ink hover:text-brand">{p?.policy_number ?? p?.internal_reference ?? j.policy_id.slice(0, 8)}</Link>
                    {p && <p className="text-xs text-muted">{p.status.replace(/_/g, " ")}</p>}
                  </Td>
                  <Td><Link href={`/organisations/${j.insurer_org_id}`} className="hover:text-brand">{orgs.get(j.insurer_org_id)?.name ?? "—"}</Link></Td>
                  <Td>{p ? cats.get(p.category_id)?.name : "—"}</Td>
                  <Td>{j.mode.replace(/_/g, " ")}{o.level ? <p className="text-xs text-muted">{o.level}</p> : null}</Td>
                  <Td>
                    <Pill tone={tone(j.status)}>{j.status.replace(/_/g, " ")}</Pill>
                    {j.review_until && j.status === "review_window" && <p className="text-[11px] text-muted">until {formatDateTime(j.review_until)}</p>}
                    <p className="text-[11px] text-muted">{j.attempts} attempt{j.attempts === 1 ? "" : "s"}</p>
                  </Td>
                  <Td className="max-w-xs text-xs">
                    {o.outcome && <Pill tone={o.outcome === "accept" ? "ok" : o.outcome === "decline" ? "danger" : "wait"}>{o.outcome}</Pill>}
                    {(o.referred_because ?? o.reason) && <p className="mt-1 text-muted">{o.referred_because ?? o.reason}</p>}
                    {j.error && <p className="mt-1 text-danger">{j.error}</p>}
                  </Td>
                  <Td className="text-xs">{nic.status ? nic.status.replace(/_/g, " ") : "—"}{nic.reference ? <p className="font-mono text-[11px] text-muted">{nic.reference}</p> : null}</Td>
                  <Td className="text-xs">{docs.length ? docs.map((d) => d.kind).join(", ") : "—"}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(j.updated_at)}</Td>
                  <Td>
                    {(j.status === "failed" || j.status === "queued") && p?.status === "pending_issuance" && (
                      <ActionForm action={retryIssuanceJob} submitLabel="Retry" submitVariant="outline" inline readOnly={!canAct} audited={false}>
                        <input type="hidden" name="jobId" value={j.id} />
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              );
            })}
            {(rows ?? []).length === 0 && <tr><Td colSpan={10} className="text-center text-sm text-muted">No issuance jobs match.</Td></tr>}
          </tbody>
        </Table>
        <Pagination base="/issuance" params={params} page={page} total={count} />
      </div>
    </div>
  );
}
