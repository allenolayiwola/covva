import { Suspense } from "react";
import Link from "next/link";
import { subscriptionSummary } from "@im/core";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { sponsorSubscriptionOp } from "./actions";

export default function SponsorSubscriptionsPage({ searchParams }: PageProps<"/subscriptions/sponsors">) {
  return (
    <>
      <PageHeader
        title="Sponsor subscriptions"
        description="Recurring premium collections paid by sponsors abroad (diaspora). Every collection is a GHS payment to the insurer charged to the sponsor's saved card; amounts in foreign currency are indicative. Covva never holds the money."
      />
      <Suspense fallback={<LoadingBlock label="Loading subscriptions…" />}>
        <Subs searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Subs({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canAct = can(staff.roles, "operations");
  const status = sp(params, "status");
  let q = supabase.from("sponsor_subscriptions").select("*").order("next_charge_at").limit(500);
  if (status) q = q.eq("status", status);
  const [{ data: rows }, { data: grace }] = await Promise.all([q, supabase.from("platform_settings").select("value").eq("key", "payments.grace_days").maybeSingle()]);
  const subs = rows ?? [];
  const sponsors = await profileMap(supabase, subs.map((s) => s.sponsor_user_id));
  const policyIds = [...new Set(subs.map((s) => s.policy_id).filter((id): id is string => !!id))];
  const { data: policies } = policyIds.length ? await supabase.from("policies").select("id, internal_reference, policy_number, status").in("id", policyIds) : { data: [] };
  const policyById = new Map((policies ?? []).map((p) => [p.id, p]));
  const { data: all } = status ? await supabase.from("sponsor_subscriptions").select("status, ghs_amount, cadence") : { data: subs };
  const live = (all ?? []).filter((s) => s.status === "active" || s.status === "past_due");
  const monthlyGhs = live.reduce((t, s) => t + Number(s.ghs_amount) / (s.cadence === "monthly" ? 1 : s.cadence === "quarterly" ? 3 : 12), 0);

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Active" value={(all ?? []).filter((s) => s.status === "active").length} />
        <Kpi label="Past due" value={(all ?? []).filter((s) => s.status === "past_due").length} tone={(all ?? []).some((s) => s.status === "past_due") ? "danger" : "default"} hint={`grace ${Number(grace?.value ?? 14)} days`} />
        <Kpi label="Paused" value={(all ?? []).filter((s) => s.status === "paused").length} />
        <Kpi label="Premiums collected / month" value={formatGHS(Math.round(monthlyGhs))} hint="to insurers, indicative run-rate" />
      </div>
      <FilterBar action="/subscriptions/sponsors">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "active", label: "Active" }, { value: "past_due", label: "Past due" }, { value: "paused", label: "Paused" }, { value: "cancelled", label: "Cancelled" }]} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Sponsor</Th><Th>Policy</Th><Th>Amount</Th><Th>Status</Th><Th>Next collection</Th><Th>Failures</Th><Th>PSP</Th><Th /></tr></THead>
        <tbody>
          {subs.map((s) => {
            const sum = subscriptionSummary(s);
            const sponsor = sponsors.get(s.sponsor_user_id);
            const policy = s.policy_id ? policyById.get(s.policy_id) : undefined;
            return (
              <tr key={s.id}>
                <Td><Link href={`/users/${s.sponsor_user_id}`} className="font-medium text-ink hover:text-brand">{sponsor?.full_name ?? sponsor?.email ?? s.sponsor_user_id.slice(0, 8)}</Link></Td>
                <Td>{policy ? <Link href={`/policies/${policy.id}`} className="text-brand hover:underline">{policy.policy_number ?? policy.internal_reference}</Link> : "—"}<p className="text-xs text-muted">{policy?.status ?? ""}</p></Td>
                <Td className="text-sm">{sum.amountLabel}</Td>
                <Td><Pill tone={sum.tone}>{sum.statusLabel}</Pill>{s.psp_subscription_ref && <p className="text-xs text-muted">Paystack-managed</p>}</Td>
                <Td className="text-xs">{formatDateTime(s.next_charge_at)}<p className="text-muted">{s.last_charged_at ? `last ${formatDateTime(s.last_charged_at)}` : "never charged"}</p></Td>
                <Td className={s.failures ? "font-semibold text-danger" : ""}>{s.failures}</Td>
                <Td className="text-xs">{s.psp}</Td>
                <Td>
                  {canAct && s.status !== "cancelled" && (
                    <div className="flex flex-wrap gap-1">
                      {(s.status === "past_due" || s.failures > 0) && (
                        <ActionForm action={sponsorSubscriptionOp} submitLabel="Retry" inline audited={false}>
                          <input type="hidden" name="subscriptionId" value={s.id} /><input type="hidden" name="op" value="retry" />
                        </ActionForm>
                      )}
                      {s.status !== "paused" && (
                        <ActionForm action={sponsorSubscriptionOp} submitLabel="Pause" submitVariant="secondary" inline audited={false}>
                          <input type="hidden" name="subscriptionId" value={s.id} /><input type="hidden" name="op" value="pause" />
                        </ActionForm>
                      )}
                      <ActionForm action={sponsorSubscriptionOp} submitLabel="Cancel" submitVariant="ghost" inline audited={false}>
                        <input type="hidden" name="subscriptionId" value={s.id} /><input type="hidden" name="op" value="cancel" />
                      </ActionForm>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
          {!subs.length && <tr><Td colSpan={8} className="py-8 text-center text-muted">No sponsor subscriptions{status ? ` with status ${status}` : ""}.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
