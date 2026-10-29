import { Suspense } from "react";
import Link from "next/link";
import { INSTALMENT_PLAN_LABEL, SCHEDULE_STATE_LABEL, isInstalmentPlanKey, scheduleState } from "@im/core";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { instalmentOp } from "./actions";

export default function InstalmentsAdminPage({ searchParams }: PageProps<"/instalments">) {
  return (
    <>
      <PageHeader
        title="Instalments"
        description="Premiums paid in instalments under each insurer's plan. Every instalment is a GHS payment to the insurer; collections run at 06:30 and 18:30 (MoMo prompt, saved card or pay link) with retries on day 0, +2 and +5. Grace, lapse and reinstatement follow the insurer's rules; reinstatement reviews are decided by the insurer."
      />
      <Suspense fallback={<LoadingBlock label="Loading schedules…" />}>
        <Schedules searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Schedules({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "operations");
  const status = sp(params, "status");
  const view = sp(params, "view");
  let q = supabase.from("instalment_schedules").select("*").not("policy_id", "is", null).order("updated_at", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  if (view === "lapse") q = q.eq("status", "grace");
  if (view === "review") q = q.eq("reinstatement_review", "pending");
  const [{ data: rows }, { data: counts }] = await Promise.all([q, supabase.from("instalment_schedules").select("status, reinstatement_review").not("policy_id", "is", null).limit(5000)]);
  const schedules = rows ?? [];
  const ids = schedules.map((s) => s.id);
  const [{ data: inst }, { data: policies }, people] = await Promise.all([
    ids.length ? supabase.from("instalments").select("*").in("schedule_id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("policies").select("id, internal_reference, policy_number, status").in("id", schedules.map((s) => s.policy_id!)) : Promise.resolve({ data: [] as { id: string; internal_reference: string; policy_number: string | null; status: string }[] }),
    profileMap(supabase, schedules.map((s) => s.payer_user_id)),
  ]);
  const policyById = new Map((policies ?? []).map((p) => [p.id, p]));
  const all = counts ?? [];
  const n = (st: string) => all.filter((s) => s.status === st).length;
  const now = new Date();
  const views = schedules
    .map((s) => {
      const rows = (inst ?? []).filter((i) => i.schedule_id === s.id);
      return { s, rows, state: scheduleState(s, rows, now) };
    })
    .sort((a, b) => (view === "lapse" ? (a.state.lapseAt ?? "").localeCompare(b.state.lapseAt ?? "") : 0));

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        <Kpi label="Active" value={n("active") + n("reinstated")} />
        <Kpi label="In grace" value={n("grace")} tone={n("grace") ? "danger" : "default"} hint="lapse queue" />
        <Kpi label="Lapsed" value={n("lapsed")} />
        <Kpi label="Reinstatement reviews" value={all.filter((s) => s.reinstatement_review === "pending").length} hint="decided by the insurer" />
        <Kpi label="Completed" value={n("completed")} />
      </div>
      <FilterBar action="/instalments">
        <FilterSelect name="view" label="Queue" value={view} options={[{ value: "lapse", label: "Lapse queue (in grace)" }, { value: "review", label: "Reinstatement reviews" }]} />
        <FilterSelect name="status" label="Status" value={status} options={["active", "grace", "lapsed", "reinstated", "completed", "cancelled"].map((v) => ({ value: v, label: v }))} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Payer</Th><Th>Policy</Th><Th>Plan</Th><Th>Progress</Th><Th>State</Th><Th>Next / overdue</Th><Th>Lapses on</Th><Th /></tr></THead>
        <tbody>
          {views.map(({ s, rows, state }) => {
            const payer = people.get(s.payer_user_id);
            const policy = s.policy_id ? policyById.get(s.policy_id) : undefined;
            const meta = SCHEDULE_STATE_LABEL[state.state];
            const open = rows.filter((r) => r.status === "due" || r.status === "failed").sort((a, b) => a.seq - b.seq)[0];
            return (
              <tr key={s.id}>
                <Td><Link href={`/users/${s.payer_user_id}`} className="font-medium text-ink hover:text-brand">{payer?.full_name ?? payer?.email ?? s.payer_user_id.slice(0, 8)}</Link><p className="text-xs text-muted">{s.channel === "card" ? "card" : `MoMo ${s.momo_phone ?? ""}`}</p></Td>
                <Td>{policy ? <Link href={`/policies/${policy.id}`} className="text-brand hover:underline">{policy.policy_number ?? policy.internal_reference}</Link> : "—"}<p className="text-xs text-muted">{policy?.status ?? ""}</p></Td>
                <Td className="text-sm">{isInstalmentPlanKey(s.plan_key) ? INSTALMENT_PLAN_LABEL[s.plan_key] : s.plan_key}<p className="text-xs text-muted">{formatGHS(Number(s.total_amount), { decimals: true })}</p></Td>
                <Td className="text-sm">{state.paidCount} / {state.count}</Td>
                <Td><Pill tone={meta.tone}>{s.reinstatement_review === "pending" ? "Review pending" : meta.label}</Pill></Td>
                <Td className="text-xs">{state.arrears > 0 ? <span className="font-semibold text-danger">{formatGHS(state.arrears, { decimals: true })} overdue {state.daysOverdue}d</span> : state.next ? `${formatGHS(state.next.amount, { decimals: true })} on ${formatDate(state.next.dueAt)}` : "—"}{open ? <p className="text-muted">{open.attempts} attempt{open.attempts === 1 ? "" : "s"}</p> : null}</Td>
                <Td className="text-xs">{state.state === "lapsed" ? (s.lapsed_at ? `lapsed ${formatDate(s.lapsed_at)}` : "lapsed") : state.lapseAt ? formatDate(state.lapseAt) : "—"}</Td>
                <Td>
                  {canAct && open && s.status !== "lapsed" && s.status !== "cancelled" && (
                    <div className="flex flex-wrap gap-1">
                      <ActionForm action={instalmentOp} submitLabel="Retry" inline audited={false}>
                        <input type="hidden" name="instalmentId" value={open.id} /><input type="hidden" name="op" value="retry" />
                      </ActionForm>
                      <ActionForm action={instalmentOp} submitLabel="Waive" submitVariant="ghost" inline audited={false}>
                        <input type="hidden" name="instalmentId" value={open.id} /><input type="hidden" name="op" value="waive" />
                      </ActionForm>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
          {!views.length && <tr><Td colSpan={8} className="py-8 text-center text-muted">No instalment schedules{status ? ` with status ${status}` : ""}.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
