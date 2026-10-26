import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, PageHeader, Pill, StatusPill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { QUOTE_STATUS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { requireKind } from "../../_lib/context";
import { nowMs, DAY, getCategoryMap, getOrgNames } from "../../_lib/data";
import { DueCell, PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Submissions" };

export default function SubmissionsPage({ searchParams }: PageProps<"/partner/submissions">) {
  return (
    <>
      <PageHeader title="Submissions" description="Risks submitted to you by appointed brokers. Respond with a quote or decline with a reason." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const VIEWS = [
  { key: "open", label: "Awaiting response", statuses: ["pending", "sent", "acknowledged"] },
  { key: "quoted", label: "Quoted", statuses: ["quoted"] },
  { key: "declined", label: "Declined", statuses: ["declined", "withdrawn", "error"] },
  { key: "quotes", label: "Quotes expiring" },
] as const;

async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireKind("insurer");
  const sp = await searchParams;
  const key = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "open";
  const view = VIEWS.find((v) => v.key === key) ?? VIEWS[0];

  const [{ data: subs }, { data: quotes }] = await Promise.all([
    ctx.supabase
      .from("insurer_submissions")
      .select("id, status, channel, response_due_at, responded_at, created_at, broker_org_id, request_id, request:requests!insurer_submissions_request_id_fkey(reference, category_id, type)")
      .eq("insurer_org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(1000),
    ctx.supabase
      .from("quotes")
      .select("id, status, premium, valid_until, submission_id, request_id, broker_org_id")
      .eq("insurer_org_id", ctx.orgId)
      .eq("status", "ready_to_accept")
      .gte("valid_until", new Date().toISOString())
      .order("valid_until"),
  ]);
  const all = subs ?? [];
  const [cats, brokers] = await Promise.all([getCategoryMap(), getOrgNames(ctx, [...all.map((s) => s.broker_org_id), ...(quotes ?? []).map((q) => q.broker_org_id)])]);
  const reqOf = (s: (typeof all)[number]) => s.request as unknown as { reference: string; category_id: string; type: string } | null;
  const refByReq = new Map(all.map((s) => [s.request_id, { ref: reqOf(s)?.reference, subId: s.id }]));
  const expiring = (quotes ?? []).filter((q) => q.valid_until && Date.parse(q.valid_until) - nowMs() < 3 * DAY);

  return (
    <>
      <Tabs
        active={view.key}
        items={VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          href: `/partner/submissions?view=${v.key}`,
          count: "statuses" in v ? all.filter((s) => (v.statuses as readonly string[]).includes(s.status)).length : expiring.length,
        }))}
      />
      <div className="mt-4">
        {"statuses" in view ? (
          (() => {
            const rows = all.filter((s) => (view.statuses as readonly string[]).includes(s.status));
            return rows.length === 0 ? <EmptyState title="Nothing here" body="Broker submissions appear here as soon as they are sent." /> : (
              <Table>
                <THead><tr><Th>Request</Th><Th>Broker</Th><Th>Channel</Th><Th>Status</Th><Th>Received</Th><Th>Response due</Th></tr></THead>
                <tbody>
                  {rows.map((s) => {
                    const r = reqOf(s);
                    return (
                      <tr key={s.id} className="hover:bg-mist/60">
                        <Td>
                          <Link href={`/partner/submissions/${s.id}`} className="font-semibold text-ink hover:text-brand">{r?.reference ?? "Request"}</Link>
                          <p className="text-xs text-muted">{cats.get(r?.category_id ?? "")?.name} · {humanize(r?.type ?? "")}</p>
                        </Td>
                        <Td>{s.broker_org_id ? brokers.get(s.broker_org_id) ?? "Broker" : <Pill tone="info">Direct order</Pill>}</Td>
                        <Td>{humanize(s.channel)}</Td>
                        <Td><Pill tone={s.status === "quoted" ? "ok" : s.status === "declined" ? "danger" : "wait"}>{humanize(s.status)}</Pill></Td>
                        <Td className="text-xs text-muted">{formatDateTime(s.created_at)}</Td>
                        <Td>{s.responded_at ? <span className="text-xs text-muted">Answered {formatDateTime(s.responded_at)}</span> : <DueCell dueAt={s.response_due_at} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            );
          })()
        ) : expiring.length === 0 ? (
          <EmptyState title="No quotes expiring in the next 3 days" />
        ) : (
          <Table>
            <THead><tr><Th>Request</Th><Th>Broker</Th><Th>Status</Th><Th>Premium</Th><Th>Valid until</Th></tr></THead>
            <tbody>
              {expiring.map((q) => {
                const info = refByReq.get(q.request_id);
                return (
                  <tr key={q.id}>
                    <Td>{info ? <Link href={`/partner/submissions/${info.subId}`} className="font-semibold text-ink hover:text-brand">{info.ref}</Link> : "—"}</Td>
                    <Td>{q.broker_org_id ? brokers.get(q.broker_org_id) ?? "—" : "Direct"}</Td>
                    <Td><StatusPill meta={QUOTE_STATUS[q.status]} /></Td>
                    <Td className="tabular-nums">{formatGHS(Number(q.premium))}</Td>
                    <Td className="font-medium text-amber">{formatDate(q.valid_until)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
