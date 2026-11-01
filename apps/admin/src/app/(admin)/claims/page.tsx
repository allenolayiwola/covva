import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, FileWarning, Gavel } from "lucide-react";
import { EmptyState, Notice, buttonClass } from "@im/ui";
import { CLAIM_STATUS, type ClaimStatus } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, isUuid, orgMap, pageOf, personName, profileMap, sp, withParams, type SearchParams } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, KeyValues, LoadingBlock, Pagination } from "@/components/ui/layout";
import { DrawerSection, MetaPill, PageHeader, RowLink, StatRow, StatusPill, Table, THead, Th, Td, adminTone, type Stat } from "@/components/ui/page";
import { Drawer } from "@/components/ui/drawer";
import { claimSla } from "./sla";

const BASE = "/claims";
const CLOSED = "(draft,paid,closed,withdrawn,rejected)";
const FILTER_KEYS = ["q", "status", "insurer", "open", "overdue"] as const;
const DESCRIPTION = "Oversight of claim progress and service levels across insurers.";

/**
 * Claims past the indicative service levels in ./sla.ts (not delivered within 24h, not acknowledged within 48h,
 * no decision within 30 days), as a PostgREST `or` filter.
 */
function overdueFilter(now = Date.now()): string {
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  return [
    `and(status.eq.reported,reported_at.lt.${ago(24)})`,
    `and(status.eq.delivered_to_insurer,delivered_to_insurer_at.lt.${ago(48)})`,
    `and(status.in.(acknowledged,under_assessment,info_requested),acknowledged_at.lt.${ago(30 * 24)})`,
  ].join(",");
}

export default function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  return (
    <>
      <PageHeader title="Claims" description={DESCRIPTION} />
      <Notice tone="info" icon={<Gavel className="size-4" />} title="Claim decisions are insurer-only" className="mb-5">
        Only the insurer can approve, reject or pay a claim (enforced in the database). Reporting a claim is not approval. Platform staff
        monitor status and SLAs here and escalate through the broker and insurer.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading claims…" />}>
        <ClaimList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ClaimList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const insurer = sp(params, "insurer");
  const open = sp(params, "open") === "1";
  const overdue = sp(params, "overdue") === "1";
  const q = sp(params, "q");
  const selectedId = sp(params, "id");
  const late = overdueFilter();

  let query = supabase
    .from("claims")
    .select("id, reference, status, incident_type, customer_id, insurer_org_id, broker_org_id, amount_claimed, decision_amount, reported_at, delivered_to_insurer_at, acknowledged_at, decision_at, paid_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && status in CLAIM_STATUS) query = query.eq("status", status as ClaimStatus);
  if (insurer) query = query.eq("insurer_org_id", insurer);
  if (open) query = query.not("status", "in", CLOSED);
  if (overdue) query = query.or(late);
  if (q) query = query.ilike("reference", ilikeTerm(q));

  const head = () => supabase.from("claims").select("id", { count: "exact", head: true });
  const byStatus = (...s: ClaimStatus[]) => head().in("status", s);
  const [orgs, list, cOpen, cOverdue, cReported, cInsurer, cAssessing, cInfo, cApproved, cPaid, cDeclined] = await Promise.all([
    orgMap(supabase),
    query,
    head().not("status", "in", CLOSED),
    head().or(late),
    byStatus("reported"),
    byStatus("delivered_to_insurer", "acknowledged"),
    byStatus("under_assessment"),
    byStatus("info_requested"),
    byStatus("approved", "partially_approved"),
    byStatus("paid"),
    byStatus("rejected"),
  ]);
  const rows = list.data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.customer_id));

  const filters: SearchParams = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp(params, k)]).filter(([, v]) => v));
  const hasFilters = Object.keys(filters).length > 0;
  const pageParam = page > 1 ? String(page) : undefined;
  const closeHref = withParams(BASE, filters, { page: pageParam });
  const only = (key: string, value: string) => Object.keys(filters).length === 1 && filters[key] === value;
  const stat = (label: string, value: number | null, key: string, v: string, tone?: Stat["tone"]): Stat => ({
    label,
    value: value ?? "—",
    href: withParams(BASE, {}, { [key]: v }),
    current: only(key, v),
    tone,
  });
  // Grouped statuses (e.g. "With insurer") link to their first status; the filter list offers each one.
  const stats: (Stat | "divider")[] = [
    stat("Open", cOpen.count, "open", "1"),
    stat("Past service level", cOverdue.count, "overdue", "1", "danger"),
    "divider",
    stat("Awaiting delivery", cReported.count, "status", "reported", "wait"),
    { ...stat("With insurer", cInsurer.count, "status", "delivered_to_insurer"), current: only("status", "delivered_to_insurer") || only("status", "acknowledged") },
    stat("Under assessment", cAssessing.count, "status", "under_assessment"),
    stat("More info needed", cInfo.count, "status", "info_requested", "wait"),
    "divider",
    stat("Approved", cApproved.count, "status", "approved"),
    stat("Paid", cPaid.count, "status", "paid"),
    stat("Declined", cDeclined.count, "status", "rejected"),
  ];
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer");

  return (
    <>
      <StatRow label="Claim counts" items={stats} />

      <FilterBar
        action={BASE}
        trailing={list.count != null && <span className="tabular-nums">{list.count === 1 ? "1 claim" : `${list.count.toLocaleString("en-GB")} claims`}</span>}
      >
        <FilterInput name="q" label="Reference" value={q} placeholder="CLM-501" />
        <FilterSelect name="status" label="Status" value={status} options={Object.entries(CLAIM_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="insurer" label="Insurer" value={insurer} options={insurers.map((o) => ({ value: o.id, label: o.name }))} />
        <FilterCheck name="open" label="Open only" checked={open} />
        <FilterCheck name="overdue" label="Past service level" checked={overdue} />
      </FilterBar>
      {list.error && <p className="mb-3 text-sm text-danger">{list.error.message}</p>}

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileWarning className="size-5" />}
          title={hasFilters ? "No claims match these filters" : "No claims yet"}
          body={hasFilters ? "Try a different status or insurer, or clear the filters to see every claim." : "Claims appear here once customers report them to their broker."}
          action={hasFilters ? <Link href={BASE} className={buttonClass("outline", "sm", "h-9")}>Clear filters</Link> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Claim</Th>
              <Th>Customer</Th>
              <Th>Insurer / broker</Th>
              <Th>Status</Th>
              <Th>Claimed</Th>
              <Th>Service level</Th>
              <Th>Reported</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((c) => {
              const sla = claimSla(c);
              const isSelected = c.id === selectedId;
              return (
                <tr key={c.id} className={isSelected ? "relative bg-head" : "relative hover:bg-head/70"}>
                  <Td>
                    <RowLink id={`claim-${c.id}`} href={withParams(BASE, filters, { page: pageParam, id: c.id })} current={isSelected}>{c.reference}</RowLink>
                    <p className="text-xs text-muted">{c.incident_type}</p>
                  </Td>
                  <Td>{personName(people.get(c.customer_id))}</Td>
                  <Td>
                    {orgs.get(c.insurer_org_id)?.name ?? "—"}
                    <p className="text-xs text-muted">{c.broker_org_id ? orgs.get(c.broker_org_id)?.name : "No broker"}</p>
                  </Td>
                  <Td><MetaPill meta={CLAIM_STATUS[c.status]} fallback={c.status} /></Td>
                  <Td className="tabular-nums">{formatGHS(c.amount_claimed == null ? null : Number(c.amount_claimed))}</Td>
                  <Td>{sla ? <StatusPill tone={adminTone(sla.tone)}>{sla.label}</StatusPill> : <span className="text-subtle">—</span>}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(c.reported_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination base={BASE} params={filters} page={page} total={list.count} />

      {isUuid(selectedId) && (
        <Suspense fallback={null}>
          <ClaimDrawer id={selectedId} closeHref={closeHref} />
        </Suspense>
      )}
    </>
  );
}

async function ClaimDrawer({ id, closeHref }: { id: string; closeHref: string }) {
  const supabase = await createClient();
  const { data: c } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  const [orgs, events, docs, policy] = await Promise.all([
    orgMap(supabase),
    supabase.from("claim_events").select("id, to_status, actor_party, actor_id, note, created_at").eq("claim_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("claim_id", id),
    supabase.from("policies").select("id, policy_number, internal_reference").eq("id", c.policy_id).maybeSingle(),
  ]);
  const recent = events.data ?? [];
  const people = await profileMap(supabase, [c.customer_id, ...recent.map((e) => e.actor_id)]);
  const sla = claimSla(c);
  const amount = (v: number | string | null) => formatGHS(v == null ? null : Number(v), { decimals: true });

  return (
    <Drawer
      eyebrow={orgs.get(c.insurer_org_id)?.name ?? "Claim"}
      title={c.reference}
      description={c.incident_type}
      closeHref={closeHref}
      returnFocusId={`claim-${c.id}`}
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill meta={CLAIM_STATUS[c.status]} fallback={c.status} />
          {sla && <StatusPill tone={adminTone(sla.tone)}>{sla.label}</StatusPill>}
        </div>
      }
    >
      <div className="space-y-6">
        <KeyValues
          items={[
            { label: "Customer", value: <Link href={`/users/${c.customer_id}`} className="hover:text-brand">{personName(people.get(c.customer_id))}</Link> },
            { label: "Policy", value: policy.data ? <Link href={`/policies/${policy.data.id}`} className="hover:text-brand">{policy.data.policy_number ?? policy.data.internal_reference}</Link> : "—" },
            { label: "Broker", value: c.broker_org_id ? orgs.get(c.broker_org_id)?.name ?? "—" : "No broker" },
            { label: "Incident", value: formatDateTime(c.incident_at) },
            { label: "Amount claimed", value: amount(c.amount_claimed) },
            { label: "Decision amount", value: c.decision_at ? amount(c.decision_amount) : "Pending" },
            { label: "Reported", value: formatDateTime(c.reported_at) },
            { label: "Documents", value: docs.count ?? 0 },
          ]}
        />

        <DrawerSection title="Status history">
          {recent.length ? (
            <ol className="space-y-2.5 border-l-2 border-line pl-3 text-sm">
              {recent.map((e) => (
                <li key={e.id}>
                  <p className="font-medium text-ink">{e.to_status ? CLAIM_STATUS[e.to_status]?.label ?? e.to_status : "Note"}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.created_at)} · {e.actor_party}
                    {e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}
                  </p>
                  {e.note && <p className="mt-0.5 text-ink-2">{e.note}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-subtle">No status changes recorded.</p>
          )}
        </DrawerSection>

        <p className="rounded-sm border border-line bg-head px-3 py-2 text-xs text-muted">
          Read-only. Only the insurer can approve, decline or pay this claim.
        </p>

        <div className="border-t border-line pt-4">
          <Link href={`/claims/${c.id}`} className={buttonClass("primary", "sm", "h-9")}>
            Open full claim <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Drawer>
  );
}
