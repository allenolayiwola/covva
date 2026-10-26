import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, EmptyState, PageHeader, StatCard, Tabs } from "@im/ui";
import { OPEN_REQUEST_STATUSES, QUEUE_BUCKETS, REQUEST_STATUS, type RequestStatus, type RiskField } from "@im/core";
import { requireKind } from "../../_lib/context";
import { SOURCE_LABEL, getCategoryMap, getCustomers, getOrgNames, getTeam, isAtRisk, requestKind, shortName } from "../../_lib/data";
import { getCategories } from "@/lib/catalog";
import { AutoSubmitSelect } from "@/components/partner/action-form";
import { CreateRequestButton } from "@/components/partner/create-request";
import { QueueTable, type QueueRow } from "@/components/partner/queue-table";
import { RealtimeRefresh } from "@/components/partner/realtime-refresh";
import { Chip, PageSkeleton, chipSelectClass } from "@/components/partner/ui";
import { createAssistedRequest } from "./actions";

export const metadata: Metadata = { title: "Request queue" };

export default function RequestQueuePage({ searchParams }: PageProps<"/partner/requests">) {
  return (
    <>
      <Suspense fallback={<PageHeader title="Request queue" description="One queue for mobile and web. Clear ownership at every step." />}>
        <QueueHeader />
      </Suspense>
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function QueueHeader() {
  await requireKind("broker");
  const cats = await getCategories();
  return (
    <PageHeader
      title="Request queue"
      description="One queue for mobile and web. Clear ownership at every step."
      actions={
        <CreateRequestButton
          action={createAssistedRequest}
          categories={cats.map((c) => ({ id: c.id, name: c.name, availability: c.availability, riskSchema: (c.risk_schema ?? []) as unknown as RiskField[] }))}
        />
      }
    />
  );
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function href(sp: Record<string, string>, patch: Record<string, string | null>) {
  const next = { ...sp, ...patch };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return `/partner/requests${qs ? `?${qs}` : ""}`;
}

async function Queue({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireKind("broker");
  const raw = await searchParams;
  const sp = {
    bucket: one(raw.bucket),
    mine: one(raw.mine),
    category: one(raw.category),
    source: one(raw.source),
    sort: one(raw.sort) || "due",
    risk: one(raw.risk),
  };

  const { data } = await ctx.supabase
    .from("requests")
    .select("id, reference, status, type, source, category_id, customer_id, assigned_to, team, due_at, created_at, next_step")
    .eq("broker_org_id", ctx.orgId)
    .in("status", OPEN_REQUEST_STATUSES)
    .order("created_at", { ascending: false })
    .limit(500);
  const all = data ?? [];
  const now = Date.now();

  const bucket = QUEUE_BUCKETS.find((b) => b.key === sp.bucket);
  let rows = all;
  if (bucket) rows = rows.filter((r) => bucket.statuses.includes(r.status));
  if (sp.mine) rows = rows.filter((r) => r.assigned_to === ctx.userId);
  if (sp.category) rows = rows.filter((r) => r.category_id === sp.category);
  if (sp.source) rows = rows.filter((r) => r.source === sp.source);
  if (sp.risk) rows = rows.filter((r) => isAtRisk(r.due_at, now));
  rows = [...rows].sort((a, b) =>
    sp.sort === "newest"
      ? b.created_at.localeCompare(a.created_at)
      : (a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER) - (b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER),
  );
  const visible = rows.slice(0, 100);
  const ids = visible.map((r) => r.id);

  const [cats, customers, team, tasks, quotes, payments, policies] = await Promise.all([
    getCategoryMap(),
    getCustomers(ctx, visible.map((r) => r.customer_id)),
    getTeam(ctx),
    ids.length ? ctx.supabase.from("request_tasks").select("request_id, title, status, created_at").in("request_id", ids).neq("status", "cancelled").order("created_at") : Promise.resolve({ data: [] as { request_id: string; title: string; status: string; created_at: string }[] }),
    ids.length ? ctx.supabase.from("quotes").select("request_id, insurer_org_id, status, created_at").in("request_id", ids).order("created_at") : Promise.resolve({ data: [] as { request_id: string; insurer_org_id: string; status: string; created_at: string }[] }),
    ids.length ? ctx.supabase.from("payments").select("request_id, status").in("request_id", ids) : Promise.resolve({ data: [] as { request_id: string; status: string }[] }),
    ids.length ? ctx.supabase.from("policies").select("request_id, status").in("request_id", ids) : Promise.resolve({ data: [] as { request_id: string | null; status: string }[] }),
  ]);
  const insurerNames = await getOrgNames(ctx, (quotes.data ?? []).map((q) => q.insurer_org_id));
  const members = new Map(team.map((m) => [m.userId, m]));

  const queueRows: QueueRow[] = visible.map((r) => {
    const cat = cats.get(r.category_id);
    const rQuotes = (quotes.data ?? []).filter((q) => q.request_id === r.id);
    const chosen = rQuotes.find((q) => q.status === "accepted") ?? rQuotes.find((q) => q.status === "ready_to_accept") ?? rQuotes[0];
    const rTasks = (tasks.data ?? []).filter((t) => t.request_id === r.id);
    const assignee = r.assigned_to ? members.get(r.assigned_to) : undefined;
    const checklist = [
      ...(r.next_step ? [{ label: r.next_step, done: false }] : []),
      ...rTasks.slice(0, 4).map((t) => ({ label: t.title, done: t.status === "done" })),
    ];
    if (r.status !== "submitted") checklist.unshift({ label: "Needs and request details captured", done: true });
    return {
      id: r.id,
      reference: r.reference,
      customer: shortName(customers.get(r.customer_id)),
      kind: requestKind(cat?.name, r.type),
      source: SOURCE_LABEL[r.source],
      statusLabel: REQUEST_STATUS[r.status].label,
      statusTone: REQUEST_STATUS[r.status].tone,
      owner: r.team ?? assignee?.team ?? (assignee ? assignee.name : "Unassigned"),
      ownerDetail: assignee && (r.team || assignee.team) ? assignee.name : undefined,
      dueAt: r.due_at,
      dueHint: r.status === "awaiting_customer_info" ? "Follow up" : undefined,
      preview: {
        insurer: chosen ? (insurerNames.get(chosen.insurer_org_id) ?? null) : null,
        checklist,
        checkpoints: [
          rQuotes.some((q) => q.status === "accepted"),
          (payments.data ?? []).some((p) => p.request_id === r.id && p.status === "succeeded"),
          (policies.data ?? []).some((p) => p.request_id === r.id && p.status === "active"),
          false,
        ],
      },
    };
  });

  const count = (s: RequestStatus[]) => all.filter((r) => s.includes(r.status)).length;
  const atRisk = all.filter((r) => isAtRisk(r.due_at, now)).length;
  const base = { bucket: sp.bucket, mine: sp.mine, category: sp.category, source: sp.source, sort: sp.sort === "due" ? "" : sp.sort, risk: sp.risk };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="New requests" value={String(count(["submitted"])).padStart(2, "0")} className="py-6" />
        <StatCard label="Awaiting documents" value={String(count(["awaiting_customer_info"])).padStart(2, "0")} className="py-6" />
        <StatCard label="Response target at risk" value={String(atRisk).padStart(2, "0")} tone="warn" className="py-6" />
      </div>

      <Tabs
        className="mt-6"
        active={bucket?.key ?? "all"}
        items={[
          { key: "all", label: "All open", href: href(base, { bucket: null }), count: all.length },
          ...QUEUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, href: href(base, { bucket: b.key }), count: count(b.statuses) })),
        ]}
      />

      <form action="/partner/requests" className="mt-4 flex flex-wrap items-center gap-3">
        {sp.bucket && <input type="hidden" name="bucket" value={sp.bucket} />}
        {sp.mine && <input type="hidden" name="mine" value="1" />}
        {sp.risk && <input type="hidden" name="risk" value="1" />}
        <Chip href={href({}, {})} active={!sp.mine && !sp.category && !sp.source && !sp.bucket && !sp.risk}>All open · {all.length}</Chip>
        <Chip href={href(base, { mine: sp.mine ? null : "1" })} active={!!sp.mine}>Assigned to me</Chip>
        {atRisk > 0 && <Chip href={href(base, { risk: sp.risk ? null : "1" })} active={!!sp.risk}>At risk · {atRisk}</Chip>}
        <label className="sr-only" htmlFor="q-category">Category</label>
        <AutoSubmitSelect id="q-category" name="category" defaultValue={sp.category} className={chipSelectClass}>
          <option value="">All categories</option>
          {[...cats.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </AutoSubmitSelect>
        <label className="sr-only" htmlFor="q-source">Source</label>
        <AutoSubmitSelect id="q-source" name="source" defaultValue={sp.source} className={chipSelectClass}>
          <option value="">Source: all</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>Source: {v.toLowerCase()}</option>)}
        </AutoSubmitSelect>
        <label className="sr-only" htmlFor="q-sort">Sort</label>
        <AutoSubmitSelect id="q-sort" name="sort" defaultValue={sp.sort} className={chipSelectClass}>
          <option value="due">Due next</option>
          <option value="newest">Newest first</option>
        </AutoSubmitSelect>
        <noscript><button className="text-sm text-brand underline">Apply</button></noscript>
        <span className="ml-auto"><RealtimeRefresh table="requests" filter={`broker_org_id=eq.${ctx.orgId}`} channel={`queue-${ctx.orgId}`} /></span>
      </form>

      <div className="mt-4">
        {queueRows.length === 0 ? (
          <EmptyState
            title={all.length === 0 ? "No open requests" : "No requests match these filters"}
            body={all.length === 0 ? "New requests from web, mobile and assisted channels appear here with an owner and a response target." : "Try clearing a filter."}
          />
        ) : (
          <QueueTable rows={queueRows} demo={ctx.isDemo} />
        )}
        {rows.length > visible.length && <p className="mt-3 text-sm text-muted">Showing the first {visible.length} of {rows.length}. Narrow the filters to see more.</p>}
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

