import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { EmptyState, buttonClass } from "@im/ui";
import { OPEN_REQUEST_STATUSES, REQUEST_STATUS, type RequestStatus } from "@im/core";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, ilikeTerm, isUuid, orgMap, pageOf, profileMap, personName, sp, withParams, type SearchParams } from "@/lib/query";
import { formatDateTime, relativeDue } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, KeyValues, LoadingBlock, Pagination } from "@/components/ui/layout";
import { DrawerSection, MetaPill, PageHeader, RowLink, StatRow, StatusPill, Table, THead, Th, Td, type Stat } from "@/components/ui/page";
import { Drawer } from "@/components/ui/drawer";

const BASE = "/requests";
const SOURCES: Enum<"request_source">[] = ["web", "mobile", "whatsapp", "call_centre", "admin", "api"];

/** Params that belong to the list (filters + page); the drawer param (id) is layered on top. */
const FILTER_KEYS = ["q", "status", "category", "broker", "source", "breached", "unassigned", "customer"] as const;

const DESCRIPTION = "Every request across brokers, with ownership, SLA and routing. Oversight view — brokers do the work.";

export default function RequestsPage({ searchParams }: PageProps<"/requests">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Requests" description={DESCRIPTION} />
          <LoadingBlock label="Loading requests…" />
        </>
      }
    >
      <RequestsList searchParams={searchParams} />
    </Suspense>
  );
}

async function RequestsList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);

  const status = sp(params, "status");
  const category = sp(params, "category");
  const broker = sp(params, "broker");
  const source = sp(params, "source");
  const breached = sp(params, "breached") === "1";
  const unassigned = sp(params, "unassigned") === "1";
  const q = sp(params, "q");
  const customer = sp(params, "customer");
  const selectedId = sp(params, "id");
  const nowIso = new Date().toISOString();
  const breachFilter = `sla_breached_at.not.is.null,due_at.lt.${nowIso}`;

  let query = supabase
    .from("requests")
    .select("id, reference, title, type, status, source, category_id, broker_org_id, customer_id, due_at, sla_breached_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && status in REQUEST_STATUS) query = query.eq("status", status as RequestStatus);
  else if (status === "open") query = query.in("status", OPEN_REQUEST_STATUSES);
  if (category) query = query.eq("category_id", category);
  if (broker) query = query.eq("broker_org_id", broker);
  if (source && (SOURCES as string[]).includes(source)) query = query.eq("source", source as Enum<"request_source">);
  if (breached) query = query.in("status", OPEN_REQUEST_STATUSES).or(breachFilter);
  if (unassigned) query = query.is("broker_org_id", null);
  if (q) query = query.or(`reference.ilike.${ilikeTerm(q)},title.ilike.${ilikeTerm(q)}`);
  if (isUuid(customer)) query = query.eq("customer_id", customer);

  // Summary counts across all requests (not just this page). Head-only count queries: no rows come back.
  const head = () => supabase.from("requests").select("id", { count: "exact", head: true });
  const byStatus = (s: RequestStatus) => head().eq("status", s);
  const [orgs, cats, list, cOpen, cNew, cCustomer, cAdviser, cInsurer, cQuotes, cBreached, cUnassigned, cCompleted] = await Promise.all([
    orgMap(supabase),
    categoryMap(supabase),
    query,
    head().in("status", OPEN_REQUEST_STATUSES),
    byStatus("submitted"),
    byStatus("awaiting_customer_info"),
    byStatus("adviser_action"),
    byStatus("insurer_response"),
    byStatus("quotes_ready"),
    head().in("status", OPEN_REQUEST_STATUSES).or(breachFilter),
    head().is("broker_org_id", null),
    byStatus("completed"),
  ]);
  const rows = list.data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.customer_id));
  const brokers = [...orgs.values()].filter((o) => o.type === "broker");

  const filters: SearchParams = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp(params, k)]).filter(([, v]) => v));
  const hasFilters = Object.keys(filters).length > 0;
  const pageParam = page > 1 ? String(page) : undefined;
  const closeHref = withParams(BASE, filters, { page: pageParam });
  const rowHref = (id: string) => withParams(BASE, filters, { page: pageParam, id });
  // A count is "current" when it is the only filter applied.
  const only = (key: string, value: string) => Object.keys(filters).length === 1 && filters[key] === value;
  const stat = (label: string, value: number | null, key: string, v: string, tone?: Stat["tone"]): Stat => ({
    label,
    value: value ?? "—",
    href: withParams(BASE, {}, { [key]: v }),
    current: only(key, v),
    tone,
  });
  const stats: (Stat | "divider")[] = [
    stat("Open", cOpen.count, "status", "open"),
    stat("SLA breached", cBreached.count, "breached", "1", "danger"),
    stat("Unassigned", cUnassigned.count, "unassigned", "1", "wait"),
    "divider",
    stat("New", cNew.count, "status", "submitted"),
    stat("Awaiting customer", cCustomer.count, "status", "awaiting_customer_info", "wait"),
    stat("With adviser", cAdviser.count, "status", "adviser_action"),
    stat("Awaiting insurers", cInsurer.count, "status", "insurer_response"),
    stat("Quotes ready", cQuotes.count, "status", "quotes_ready"),
    "divider",
    stat("Completed", cCompleted.count, "status", "completed"),
  ];

  return (
    <>
      <PageHeader title="Requests" description={DESCRIPTION} />
      <StatRow label="Request counts" items={stats} />

      <FilterBar
        action={BASE}
        trailing={list.count != null && <span className="tabular-nums">{list.count === 1 ? "1 request" : `${list.count.toLocaleString("en-GB")} requests`}</span>}
      >
        <FilterInput name="q" label="Reference or title" value={q} placeholder="REQ-1001" />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[{ value: "open", label: "All open" }, ...Object.entries(REQUEST_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]}
        />
        <FilterSelect name="category" label="Category" value={category} options={[...cats.values()].map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="broker" label="Broker" value={broker} options={brokers.map((b) => ({ value: b.id, label: b.name }))} />
        <FilterSelect name="source" label="Source" value={source} options={SOURCES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
        <FilterCheck name="breached" label="SLA breached" checked={breached} />
        <FilterCheck name="unassigned" label="Unassigned" checked={unassigned} />
        {customer && <input type="hidden" name="customer" value={customer} />}
      </FilterBar>
      {list.error && <p className="mb-3 text-sm text-danger">{list.error.message}</p>}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title={hasFilters ? "No requests match these filters" : "No requests yet"}
          body={hasFilters ? "Try a different status or broker, or clear the filters to see every request." : "Requests appear here as soon as customers send them."}
          action={hasFilters ? <Link href={BASE} className={buttonClass("outline", "sm", "h-9")}>Clear filters</Link> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Request / customer</Th>
              <Th>Category</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Broker of record</Th>
              <Th>Next response</Th>
              <Th>Created</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => {
              const isSelected = r.id === selectedId;
              return (
                <tr key={r.id} className={isSelected ? "relative bg-head" : "relative hover:bg-head/70"}>
                  <Td>
                    <RowLink id={`request-${r.id}`} href={rowHref(r.id)} current={isSelected}>{r.reference}</RowLink>
                    <span className="text-muted"> · {personName(people.get(r.customer_id), "Customer")}</span>
                    <p className="text-xs text-muted">{r.title ?? r.type.replace("_", " ")}</p>
                  </Td>
                  <Td>{cats.get(r.category_id)?.name ?? "—"}</Td>
                  <Td className="capitalize">{r.source.replace("_", " ")}</Td>
                  <Td><MetaPill meta={REQUEST_STATUS[r.status]} fallback={r.status} /></Td>
                  <Td>{r.broker_org_id ? orgs.get(r.broker_org_id)?.name ?? "—" : <StatusPill tone="wait">Unassigned</StatusPill>}</Td>
                  <Td><NextResponse status={r.status} dueAt={r.due_at} breachedAt={r.sla_breached_at} /></Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination base={BASE} params={filters} page={page} total={list.count} />

      {isUuid(selectedId) && (
        <Suspense fallback={null}>
          <RequestDrawer id={selectedId} closeHref={closeHref} />
        </Suspense>
      )}
    </>
  );
}

function NextResponse({ status, dueAt, breachedAt }: { status: RequestStatus; dueAt: string | null; breachedAt: string | null }) {
  if (!OPEN_REQUEST_STATUSES.includes(status)) return <span className="text-subtle">—</span>;
  const due = relativeDue(dueAt);
  return (
    <>
      <p className="font-medium text-ink">{due.label}</p>
      {(due.overdue || breachedAt) && <p className="text-xs text-status-danger">SLA breached</p>}
      {!due.overdue && !breachedAt && due.atRisk && <p className="text-xs text-status-wait">At risk</p>}
    </>
  );
}

async function RequestDrawer({ id, closeHref }: { id: string; closeHref: string }) {
  const supabase = await createClient();
  const { data: r } = await supabase.from("requests").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [orgs, cats, events, quotes, policies] = await Promise.all([
    orgMap(supabase),
    categoryMap(supabase),
    supabase.from("request_events").select("id, event, to_status, actor_party, actor_id, note, created_at").eq("request_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("request_id", id),
    supabase.from("policies").select("id", { count: "exact", head: true }).eq("request_id", id),
  ]);
  const recent = events.data ?? [];
  const people = await profileMap(supabase, [r.customer_id, r.assigned_to, ...recent.map((e) => e.actor_id)]);
  const open = OPEN_REQUEST_STATUSES.includes(r.status);
  const due = relativeDue(r.due_at);
  const breachedNow = open && (due.overdue || !!r.sla_breached_at);

  return (
    <Drawer
      eyebrow={`${cats.get(r.category_id)?.name ?? "Request"} · ${r.type.replace("_", " ")}`}
      title={r.reference}
      description={r.title ?? undefined}
      closeHref={closeHref}
      returnFocusId={`request-${r.id}`}
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill meta={REQUEST_STATUS[r.status]} fallback={r.status} />
          {breachedNow && <StatusPill tone="danger">SLA breached</StatusPill>}
          {!r.broker_org_id && <StatusPill tone="wait">Unassigned</StatusPill>}
        </div>
      }
    >
      <div className="space-y-6">
        <KeyValues
          items={[
            { label: "Customer", value: <Link href={`/users/${r.customer_id}`} className="hover:text-brand">{personName(people.get(r.customer_id), "Customer")}</Link> },
            { label: "Source", value: <span className="capitalize">{r.source.replace("_", " ")}</span> },
            { label: "Broker of record", value: r.broker_org_id ? orgs.get(r.broker_org_id)?.name ?? "—" : "Unassigned" },
            { label: "Adviser", value: r.assigned_to ? personName(people.get(r.assigned_to), "Adviser") : "Not assigned" },
            { label: "Next response", value: open ? due.label : "—" },
            { label: "Created", value: formatDateTime(r.created_at) },
            { label: "Quotes", value: quotes.count ?? 0 },
            { label: "Policies", value: policies.count ?? 0 },
          ]}
        />

        <DrawerSection title="Recent activity">
          {recent.length ? (
            <ol className="space-y-2.5 border-l-2 border-line pl-3 text-sm">
              {recent.map((e) => (
                <li key={e.id}>
                  <p className="font-medium text-ink">{e.to_status ? REQUEST_STATUS[e.to_status]?.label ?? e.event.replace(/_/g, " ") : e.event.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.created_at)} · {e.actor_party}
                    {e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}
                  </p>
                  {e.note && <p className="mt-0.5 text-ink-2">{e.note}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-subtle">No activity recorded.</p>
          )}
        </DrawerSection>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Link href={`/requests/${r.id}`} className={buttonClass("primary", "sm", "h-9")}>
            Open full request <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="text-xs text-muted">Reassigning, notes and cancellation are on the full request.</p>
        </div>
      </div>
    </Drawer>
  );
}
