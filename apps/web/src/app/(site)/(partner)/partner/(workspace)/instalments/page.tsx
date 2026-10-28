import type { Metadata } from "next";
import { Suspense } from "react";
import { INSTALMENT_PLAN_LABEL, SCHEDULE_STATE_LABEL, formatDate, formatGHS, isInstalmentPlanKey, scheduleState } from "@im/core";
import { Input, PageHeader, Pill, Table, Td, Th, THead } from "@im/ui";
import { can, requireKind, ROLES } from "../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";
import { decideReinstatementAction } from "./actions";

export const metadata: Metadata = { title: "Instalments" };

export default function InsurerInstalmentsPage() {
  return (
    <>
      <PageHeader title="Instalments" description="Policies paid in instalments under your plans. Grace, lapse and reinstatement follow the rules on each product version; Covva collects and every payment settles to you in cedis." />
      <Suspense fallback={<PageSkeleton />}>
        <Schedules />
      </Suspense>
    </>
  );
}

async function Schedules() {
  const ctx = await requireKind("insurer");
  const canDecide = can(ctx, ROLES.underwrite);
  const { data } = await ctx.supabase.from("instalment_schedules").select("*").eq("insurer_org_id", ctx.orgId).not("policy_id", "is", null).order("updated_at", { ascending: false }).limit(500);
  const schedules = data ?? [];
  const ids = schedules.map((s) => s.id);
  const [{ data: inst }, { data: policies }] = await Promise.all([
    ids.length ? ctx.supabase.from("instalments").select("*").in("schedule_id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? ctx.supabase.from("policies").select("id, internal_reference, policy_number, status").in("id", schedules.map((s) => s.policy_id!)) : Promise.resolve({ data: [] as { id: string; internal_reference: string; policy_number: string | null; status: string }[] }),
  ]);
  const policyById = new Map((policies ?? []).map((p) => [p.id, p]));
  const now = new Date();
  const rows = schedules.map((s) => ({ s, state: scheduleState(s, (inst ?? []).filter((i) => i.schedule_id === s.id), now) }));
  const reviews = rows.filter((r) => r.s.reinstatement_review === "pending");

  return (
    <>
      <Section title="Reinstatement reviews" description="Arrears paid on a lapsed plan that requires your review.">
        {reviews.length === 0 ? (
          <Empty>Nothing to review.</Empty>
        ) : (
          <ul className="space-y-3">
            {reviews.map(({ s, state }) => {
              const p = s.policy_id ? policyById.get(s.policy_id) : undefined;
              return (
                <li key={s.id} className="rounded-card border border-line p-4">
                  <p className="font-medium text-ink">{p?.policy_number ?? p?.internal_reference ?? "Policy"} · {isInstalmentPlanKey(s.plan_key) ? INSTALMENT_PLAN_LABEL[s.plan_key] : s.plan_key}</p>
                  <p className="text-sm text-muted">Lapsed {s.lapsed_at ? formatDate(s.lapsed_at) : ""} · {state.paidCount} of {state.count} paid · arrears settled</p>
                  {canDecide && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <ActionForm action={decideReinstatementAction} submitLabel="Approve reinstatement" className="flex items-end gap-2">
                        <input type="hidden" name="scheduleId" value={s.id} />
                        <input type="hidden" name="decision" value="approve" />
                      </ActionForm>
                      <ActionForm action={decideReinstatementAction} submitLabel="Decline and refund" confirm="Decline the reinstatement? The arrears paid are refunded to the customer." className="flex items-end gap-2">
                        <input type="hidden" name="scheduleId" value={s.id} />
                        <input type="hidden" name="decision" value="decline" />
                        <Input name="note" placeholder="Reason (shown to the customer)" className="h-9 text-sm" />
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="All schedules" className="mt-6">
        {rows.length === 0 ? (
          <Empty>No instalment plans yet. Add plans to a draft product version (Products → version → Periods, instalments and micro cover).</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Policy</Th><Th>Plan</Th><Th>Paid</Th><Th>State</Th><Th>Next / overdue</Th></tr></THead>
            <tbody>
              {rows.map(({ s, state }) => {
                const p = s.policy_id ? policyById.get(s.policy_id) : undefined;
                const meta = SCHEDULE_STATE_LABEL[state.state];
                return (
                  <tr key={s.id}>
                    <Td>{p?.policy_number ?? p?.internal_reference ?? "—"}<p className="text-xs text-muted">{p?.status}</p></Td>
                    <Td className="text-sm">{isInstalmentPlanKey(s.plan_key) ? INSTALMENT_PLAN_LABEL[s.plan_key] : s.plan_key} · {formatGHS(Number(s.total_amount), { decimals: true })}</Td>
                    <Td className="text-sm">{state.paidCount} / {state.count}</Td>
                    <Td><Pill tone={meta.tone}>{meta.label}</Pill></Td>
                    <Td className="text-xs">{state.arrears > 0 ? `${formatGHS(state.arrears, { decimals: true })} overdue ${state.daysOverdue}d · lapses ${state.lapseAt ? formatDate(state.lapseAt) : "—"}` : state.next ? `${formatGHS(state.next.amount, { decimals: true })} on ${formatDate(state.next.dueAt)}` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
