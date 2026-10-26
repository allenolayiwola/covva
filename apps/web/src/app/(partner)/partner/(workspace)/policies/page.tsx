import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, PageHeader, Pill, StatCard, StatusPill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { OPEN_REQUEST_STATUSES, POLICY_STATUS, daysUntil, formatDate, formatGHS, type PolicyStatus } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { getCategoryMap, getCustomers, getOrgNames, shortName } from "../../_lib/data";
import { ActionForm, AutoSubmitSelect } from "@/components/partner/action-form";
import { Empty, PageSkeleton, Section, chipSelectClass } from "@/components/partner/ui";
import { startRenewal } from "./actions";

export const metadata: Metadata = { title: "Policies" };

export default function PoliciesPage({ searchParams }: PageProps<"/partner/policies">) {
  return (
    <>
      <PageHeader title="Policies" description="Your book of business. Only the insurer activates cover; renewals start here." />
      <Suspense fallback={<PageSkeleton />}>
        <Policies searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const WINDOWS = [7, 14, 30, 45] as const;

async function Policies({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireKind("broker");
  const raw = await searchParams;
  const view = one(raw.view) || "book";
  const status = one(raw.status);
  const category = one(raw.category);
  const expiring = one(raw.expiring);

  const { data } = await ctx.supabase
    .from("policies")
    .select("id, policy_number, internal_reference, status, customer_id, insurer_org_id, category_id, cover_start, cover_end, premium, external_source")
    .eq("broker_org_id", ctx.orgId)
    .order("cover_end", { ascending: true, nullsFirst: false })
    .limit(2000);
  const all = data ?? [];
  const [cats, customers, insurers, { data: renewalReqs }] = await Promise.all([
    getCategoryMap(),
    getCustomers(ctx, all.map((p) => p.customer_id)),
    getOrgNames(ctx, all.map((p) => p.insurer_org_id)),
    ctx.supabase.from("requests").select("id, reference, related_policy_id, status").eq("broker_org_id", ctx.orgId).eq("type", "renewal").in("status", OPEN_REQUEST_STATUSES),
  ]);
  const renewalOf = new Map((renewalReqs ?? []).map((r) => [r.related_policy_id, r]));
  const canWork = can(ctx, ROLES.brokerWork);

  const due = all
    .filter((p) => p.status === "active" && p.cover_end)
    .map((p) => ({ p, days: daysUntil(p.cover_end)! }))
    .filter((x) => x.days >= 0 && x.days <= 45);
  const bucketOf = (d: number) => WINDOWS.find((w) => d <= w)!;

  let rows = all;
  if (status) rows = rows.filter((p) => p.status === status);
  if (category) rows = rows.filter((p) => p.category_id === category);
  if (expiring) rows = rows.filter((p) => p.cover_end && (daysUntil(p.cover_end) ?? 999) <= Number(expiring) && (daysUntil(p.cover_end) ?? -1) >= 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active policies" value={all.filter((p) => p.status === "active").length} />
        <StatCard label="Pending insurer issuance" value={all.filter((p) => p.status === "pending_issuance").length} tone="warn" />
        <StatCard label="Renewals due in 30 days" value={due.filter((x) => x.days <= 30).length} />
        <StatCard label="Annual premium in force" value={formatGHS(all.filter((p) => p.status === "active").reduce((s, p) => s + Number(p.premium ?? 0), 0))} />
      </div>
      <Tabs
        className="mt-6"
        active={view}
        items={[
          { key: "book", label: "Book of business", href: "/partner/policies", count: all.length },
          { key: "renewals", label: "Renewal pipeline", href: "/partner/policies?view=renewals", count: due.length },
        ]}
      />

      {view === "renewals" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-4">
          {WINDOWS.map((w) => {
            const items = due.filter((x) => bucketOf(x.days) === w);
            return (
              <Section key={w} title={`Due in ≤ ${w} days`} description={`${items.length} polic${items.length === 1 ? "y" : "ies"}`} tone={w <= 14 ? "mist" : "white"}>
                {items.length === 0 ? <Empty>None.</Empty> : (
                  <ul className="space-y-3">
                    {items.map(({ p, days }) => {
                      const renewal = renewalOf.get(p.id);
                      return (
                        <li key={p.id} className="rounded-xl border border-line bg-white p-3 text-sm">
                          <p className="font-semibold text-ink">{shortName(customers.get(p.customer_id))}</p>
                          <p className="text-xs text-muted">{cats.get(p.category_id)?.name} · {insurers.get(p.insurer_org_id)} · {p.policy_number ?? p.internal_reference}</p>
                          <p className={days <= 7 ? "mt-1 text-xs font-medium text-amber" : "mt-1 text-xs text-muted"}>Expires {formatDate(p.cover_end)} ({days} day{days === 1 ? "" : "s"})</p>
                          <div className="mt-2">
                            {renewal ? (
                              <Link href={`/partner/requests/${renewal.id}`} className="text-sm font-medium text-brand hover:underline">Renewal {renewal.reference} →</Link>
                            ) : canWork ? (
                              <ActionForm action={startRenewal} submitLabel="Start renewal" variant="secondary">
                                <input type="hidden" name="policyId" value={p.id} />
                              </ActionForm>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            );
          })}
          <p className="text-xs text-subtle lg:col-span-4">Renewal price ranges shown to customers are always labelled as estimates until the insurer confirms.</p>
        </div>
      ) : (
        <>
          <form action="/partner/policies" className="mt-4 flex flex-wrap gap-3">
            <label className="sr-only" htmlFor="p-status">Status</label>
            <AutoSubmitSelect id="p-status" name="status" defaultValue={status} className={chipSelectClass}>
              <option value="">All statuses</option>
              {(Object.keys(POLICY_STATUS) as PolicyStatus[]).map((s) => <option key={s} value={s}>{POLICY_STATUS[s].label}</option>)}
            </AutoSubmitSelect>
            <label className="sr-only" htmlFor="p-cat">Category</label>
            <AutoSubmitSelect id="p-cat" name="category" defaultValue={category} className={chipSelectClass}>
              <option value="">All categories</option>
              {[...cats.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </AutoSubmitSelect>
            <label className="sr-only" htmlFor="p-exp">Expiring</label>
            <AutoSubmitSelect id="p-exp" name="expiring" defaultValue={expiring} className={chipSelectClass}>
              <option value="">Any expiry</option>
              {WINDOWS.map((w) => <option key={w} value={w}>Expiring in {w} days</option>)}
            </AutoSubmitSelect>
          </form>
          <div className="mt-4">
            {rows.length === 0 ? <EmptyState title="No policies match" body="Policies appear once insurers issue cover arranged by your team." /> : (
              <Table>
                <THead><tr><Th>Policy / customer</Th><Th>Category</Th><Th>Insurer</Th><Th>Status</Th><Th>Cover</Th><Th>Premium</Th><Th /></tr></THead>
                <tbody>
                  {rows.map((p) => {
                    const days = p.cover_end ? daysUntil(p.cover_end) : null;
                    return (
                      <tr key={p.id} className="hover:bg-mist/60">
                        <Td>
                          <p className="font-semibold text-ink">{p.policy_number ?? p.internal_reference}</p>
                          <Link href={`/partner/customers/${p.customer_id}`} className="text-xs text-muted hover:text-brand">{shortName(customers.get(p.customer_id))}</Link>
                        </Td>
                        <Td>{cats.get(p.category_id)?.name ?? "—"}</Td>
                        <Td>{insurers.get(p.insurer_org_id) ?? "—"}{p.external_source && <Pill className="ml-1">External</Pill>}</Td>
                        <Td><StatusPill meta={POLICY_STATUS[p.status]} /></Td>
                        <Td>{formatDate(p.cover_start)} – {formatDate(p.cover_end)}{days !== null && days >= 0 && days <= 45 && p.status === "active" && <p className="text-xs text-amber">Renewal in {days} days</p>}</Td>
                        <Td className="tabular-nums">{formatGHS(p.premium != null ? Number(p.premium) : null)}</Td>
                        <Td>{renewalOf.get(p.id) ? <Link href={`/partner/requests/${renewalOf.get(p.id)!.id}`} className="text-xs font-medium text-brand">Renewal open</Link> : null}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>
        </>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
