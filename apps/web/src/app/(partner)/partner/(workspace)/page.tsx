import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, PageHeader, Pill, StatCard, StatusPill, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { CLAIM_STATUS, OPEN_REQUEST_STATUSES, REQUEST_STATUS, formatDate, formatDateTime, humanize, type ClaimStatus } from "@im/core";
import { getPartnerContext, type PartnerContext } from "../_lib/context";
import { DAY, getCategoryMap, getCustomers, getOrgNames, isAtRisk, requestKind, shortName } from "../_lib/data";
import { Bars, DueCell, Empty, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";

export default function OverviewPage() {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={3} /></>}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const ctx = await getPartnerContext();
  return ctx.kind === "insurer" ? <InsurerOverview ctx={ctx} /> : <BrokerOverview ctx={ctx} />;
}

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------
async function BrokerOverview({ ctx }: { ctx: PartnerContext }) {
  const sb = ctx.supabase;
  const now = Date.now();
  const in30 = new Date(now + 30 * DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);

  const [open, submissions, renewals, complaints, claims, events] = await Promise.all([
    sb.from("requests").select("id, reference, status, type, category_id, customer_id, assigned_to, team, due_at, source").eq("broker_org_id", ctx.orgId).in("status", OPEN_REQUEST_STATUSES).order("due_at", { ascending: true, nullsFirst: false }).limit(500),
    sb.from("insurer_submissions").select("id", { count: "exact", head: true }).eq("broker_org_id", ctx.orgId).in("status", ["pending", "sent", "acknowledged"]),
    sb.from("policies").select("id", { count: "exact", head: true }).eq("broker_org_id", ctx.orgId).eq("status", "active").gte("cover_end", today).lte("cover_end", in30),
    sb.from("complaints").select("id", { count: "exact", head: true }).eq("owner_org_id", ctx.orgId).not("status", "in", "(resolved,closed)"),
    sb.from("claims").select("id", { count: "exact", head: true }).eq("broker_org_id", ctx.orgId).not("status", "in", "(draft,paid,closed,withdrawn,rejected)"),
    sb.from("request_events").select("id, event, from_status, to_status, note, actor_party, created_at, request:requests!inner(id, reference, broker_org_id)").eq("request.broker_org_id", ctx.orgId).order("created_at", { ascending: false }).limit(12),
  ]);

  const rows = open.data ?? [];
  const [cats, customers] = await Promise.all([getCategoryMap(), getCustomers(ctx, rows.map((r) => r.customer_id))]);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const atRisk = rows.filter((r) => isAtRisk(r.due_at, now));
  const mine = rows.filter((r) => r.assigned_to === ctx.userId);

  const kpis: { label: string; value: number; warn?: boolean; href: string }[] = [
    { label: "New requests", value: count("submitted"), href: "/partner/requests?bucket=new" },
    { label: "Awaiting documents", value: count("awaiting_customer_info"), href: "/partner/requests?bucket=customer" },
    { label: "Response target at risk", value: atRisk.length, warn: true, href: "/partner/requests?risk=1" },
    { label: "Quotes awaiting insurer", value: submissions.count ?? 0, href: "/partner/quotes" },
    { label: "Payments to confirm", value: count("payment_confirmation"), href: "/partner/requests?bucket=payment" },
    { label: "Renewals due in 30 days", value: renewals.count ?? 0, href: "/partner/policies?view=renewals" },
    { label: "Open complaints", value: complaints.count ?? 0, href: "/partner/service#complaints" },
    { label: "Claims assisting", value: claims.count ?? 0, href: "/partner/service#claims" },
  ];

  const byBucket = Object.entries(REQUEST_STATUS)
    .filter(([k]) => OPEN_REQUEST_STATUSES.includes(k as never))
    .map(([k, m]) => ({ label: m.label, value: count(k), tone: k === "awaiting_customer_info" ? ("amber" as const) : ("brand" as const) }));

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${ctx.orgName} · What needs attention today. Clear ownership at every step.`}
        actions={<Link href="/partner/requests" className={buttonClass("primary", "md")}>Open request queue</Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="rounded-card focus-visible:ring-2 focus-visible:ring-brand">
            <StatCard label={k.label} value={String(k.value).padStart(2, "0")} tone={k.warn && k.value > 0 ? "warn" : "default"} className="h-full transition-colors hover:border-brand/40" />
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Section title="My assigned work" description="Open requests assigned to you, soonest response first.">
            {mine.length === 0 ? (
              <Empty>Nothing is assigned to you right now. Pick up a new request from the queue.</Empty>
            ) : (
              <Table>
                <THead><tr><Th>Request / customer</Th><Th>Status</Th><Th>Next response</Th></tr></THead>
                <tbody>
                  {mine.slice(0, 10).map((r) => (
                    <tr key={r.id} className="hover:bg-mist/60">
                      <Td>
                        <Link href={`/partner/requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference} · {shortName(customers.get(r.customer_id))}</Link>
                        <p className="text-xs text-muted">{requestKind(cats.get(r.category_id)?.name, r.type)}</p>
                      </Td>
                      <Td><StatusPill meta={REQUEST_STATUS[r.status]} /></Td>
                      <Td><DueCell dueAt={r.due_at} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>

          <Section title="Response target at risk" description="Due within 4 hours or overdue. Overdue items escalate to supervisors.">
            {atRisk.length === 0 ? (
              <Empty>No requests are at risk. Well done.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {atRisk.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/partner/requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference} · {shortName(customers.get(r.customer_id))}</Link>
                      <p className="text-xs text-muted">{REQUEST_STATUS[r.status].label} · {r.team ?? "Unassigned team"}</p>
                    </div>
                    <DueCell dueAt={r.due_at} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Open work by stage">
            <Bars items={byBucket} />
          </Section>
          <Section title="Recent activity">
            {(events.data ?? []).length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {(events.data ?? []).map((e) => {
                  const req = e.request as unknown as { id: string; reference: string };
                  return (
                    <li key={e.id} className="text-sm">
                      <Link href={`/partner/requests/${req.id}`} className="font-medium text-ink hover:text-brand">{req.reference}</Link>{" "}
                      <span className="text-muted">
                        {e.event === "status_changed" && e.to_status ? `moved to ${REQUEST_STATUS[e.to_status].label}` : humanize(e.event).toLowerCase()}
                        {e.actor_party ? ` · ${e.actor_party}` : ""}
                      </span>
                      <p className="text-xs text-subtle">{formatDateTime(e.created_at)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Insurer
// ---------------------------------------------------------------------------
async function InsurerOverview({ ctx }: { ctx: PartnerContext }) {
  const sb = ctx.supabase;
  const soon = new Date(Date.now() + 3 * DAY).toISOString();
  const nowIso = new Date().toISOString();

  const [subs, expiring, toIssue, claims, products] = await Promise.all([
    sb.from("insurer_submissions").select("id, status, response_due_at, created_at, broker_org_id, request:requests(reference, category_id)").eq("insurer_org_id", ctx.orgId).in("status", ["pending", "sent", "acknowledged"]).order("response_due_at", { ascending: true, nullsFirst: false }).limit(50),
    sb.from("quotes").select("id, premium, valid_until, request_id").eq("insurer_org_id", ctx.orgId).eq("status", "ready_to_accept").gte("valid_until", nowIso).lte("valid_until", soon),
    sb.from("policies").select("id", { count: "exact", head: true }).eq("insurer_org_id", ctx.orgId).eq("status", "pending_issuance"),
    sb.from("claims").select("status").eq("insurer_org_id", ctx.orgId).limit(1000),
    sb.from("products").select("id, name, versions:product_versions!product_versions_product_id_fkey(id, version, status)").eq("insurer_org_id", ctx.orgId),
  ]);

  const subRows = subs.data ?? [];
  const [cats, brokers] = await Promise.all([getCategoryMap(), getOrgNames(ctx, subRows.map((s) => s.broker_org_id))]);
  const claimCounts = new Map<ClaimStatus, number>();
  for (const c of claims.data ?? []) claimCounts.set(c.status, (claimCounts.get(c.status) ?? 0) + 1);
  const openClaims = (claims.data ?? []).filter((c) => !["paid", "closed", "withdrawn", "rejected", "draft"].includes(c.status)).length;
  const pendingVersions = (products.data ?? []).flatMap((p) =>
    ((p.versions ?? []) as { id: string; version: number; status: string }[]).filter((v) => v.status === "pending_approval" || v.status === "draft").map((v) => ({ ...v, product: p.name, productId: p.id })),
  );

  return (
    <>
      <PageHeader title="Overview" description={`${ctx.orgName} · Level 1 partner portal: submissions, issuance, claims and product data.`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Link href="/partner/submissions"><StatCard label="Submissions awaiting response" value={String(subRows.length).padStart(2, "0")} tone={subRows.some((s) => isAtRisk(s.response_due_at)) ? "warn" : "default"} className="h-full" /></Link>
        <Link href="/partner/submissions?view=quotes"><StatCard label="Quotes expiring in 3 days" value={String(expiring.data?.length ?? 0).padStart(2, "0")} className="h-full" /></Link>
        <Link href="/partner/issuance"><StatCard label="Policies to issue" value={String(toIssue.count ?? 0).padStart(2, "0")} tone={(toIssue.count ?? 0) > 0 ? "warn" : "default"} className="h-full" /></Link>
        <Link href="/partner/claims"><StatCard label="Open claims" value={String(openClaims).padStart(2, "0")} className="h-full" /></Link>
        <Link href="/partner/products"><StatCard label="Product changes pending" value={String(pendingVersions.length).padStart(2, "0")} className="h-full" /></Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Submissions awaiting your response" actions={<Link href="/partner/submissions" className={buttonClass("secondary", "sm")}>Open inbox</Link>}>
          {subRows.length === 0 ? (
            <Empty>No submissions are waiting. New broker submissions appear here.</Empty>
          ) : (
            <Table>
              <THead><tr><Th>Request</Th><Th>Broker</Th><Th>Status</Th><Th>Response due</Th></tr></THead>
              <tbody>
                {subRows.slice(0, 10).map((s) => {
                  const req = s.request as unknown as { reference: string; category_id: string } | null;
                  return (
                    <tr key={s.id} className="hover:bg-mist/60">
                      <Td>
                        <Link href={`/partner/submissions/${s.id}`} className="font-semibold text-ink hover:text-brand">{req?.reference ?? "Request"}</Link>
                        <p className="text-xs text-muted">{cats.get(req?.category_id ?? "")?.name ?? ""}</p>
                      </Td>
                      <Td>{brokers.get(s.broker_org_id) ?? "Broker"}</Td>
                      <Td><Pill tone={s.status === "acknowledged" ? "info" : "wait"}>{humanize(s.status)}</Pill></Td>
                      <Td><DueCell dueAt={s.response_due_at} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Claims by status">
            {claimCounts.size === 0 ? <Empty>No claims yet.</Empty> : (
              <Bars items={[...claimCounts.entries()].map(([k, v]) => ({ label: CLAIM_STATUS[k].label, value: v, tone: CLAIM_STATUS[k].tone === "wait" ? "amber" : "brand" }))} />
            )}
          </Section>
          <Section title="Product data changes">
            {pendingVersions.length === 0 ? <Empty>No versions awaiting platform approval.</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {pendingVersions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between py-2">
                    <Link href={`/partner/products/${v.productId}`} className="font-medium text-ink hover:text-brand">{v.product} · v{v.version}</Link>
                    <Pill tone="wait">{humanize(v.status)}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <p className="text-xs text-subtle">Updated {formatDate(new Date(), "long")}. Only the insurer activates cover and decides claims.</p>
        </div>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
