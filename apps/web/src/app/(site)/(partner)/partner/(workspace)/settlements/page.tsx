import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, Td, Th, THead } from "@im/ui";
import { formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import type { Row } from "@im/db";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../_lib/context";
import { getOrgNames } from "../../_lib/data";
import { Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Settlements" };

/**
 * Settlement statements for the organisation (RLS: owners, admins and finance). Brokers see
 * commission earned and any revenue share owed to Covva; insurers see premiums received and
 * the commission and platform fees payable out of them. Premiums settle to the insurer
 * directly — Covva never holds them.
 */
export default function SettlementsPage({ searchParams }: PageProps<"/partner/settlements">) {
  return (
    <>
      <PageHeader
        title="Settlements"
        description="Monthly statements built from the ledger: what was paid, what is owed and what is due to you."
        // A route handler (CSV download), not a page: a plain anchor is right here.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        actions={<a href="/partner/settlements/export" className="text-sm font-semibold text-brand hover:underline">Export ledger (CSV)</a>}
      />
      <Suspense fallback={<PageSkeleton stats={3} />}>
        <Settlements searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TONE = { draft: "wait", issued: "info", paid: "ok" } as const;
const ENTRY_LABEL: Record<string, string> = {
  premium_received: "Premium received",
  premium_to_insurer: "Premium to insurer",
  broker_commission: "Broker commission",
  platform_fee: "Platform fee",
  revenue_share: "Revenue share",
  subscription_fee: "Subscription fee",
  refund: "Refund",
  adjustment: "Adjustment",
};

type Statement = Row<"settlement_statements">;
type Entry = Row<"ledger_entries">;

async function Settlements({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  if (!can(ctx, ROLES.billing)) return <Notice tone="info">Settlement statements are visible to owners, admins and finance.</Notice>;
  const sp = await searchParams;
  const selected = typeof sp.statement === "string" ? sp.statement : null;

  const { data: statements } = await ctx.supabase
    .from("settlement_statements")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("period_start", { ascending: false })
    .limit(36);
  const list = (statements ?? []) as Statement[];
  const current = (selected && list.find((s) => s.id === selected)) || list[0] || null;

  return (
    <div className="space-y-6">
      <Summary ctx={ctx} />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Section title="Statements" description={list.length ? `${list.length} period${list.length === 1 ? "" : "s"}` : undefined}>
          {list.length === 0 ? (
            <Empty>No statements yet. They are drafted on the 1st of each month for the previous month.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li key={s.id}>
                  <Link href={`/partner/settlements?statement=${s.id}`} className={`flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand ${current?.id === s.id ? "font-semibold text-ink" : "text-ink-2"}`}>
                    <span>{formatDate(s.period_start)} – {formatDate(s.period_end)}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {formatGHS(Number(s.net_due), { decimals: true })}
                      <Pill tone={STATUS_TONE[s.status as keyof typeof STATUS_TONE] ?? "neutral"}>{humanize(s.status)}</Pill>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {current ? <Detail ctx={ctx} statement={current} /> : <Section title="Statement detail"><Empty>Select a statement to see its lines.</Empty></Section>}
      </div>
    </div>
  );
}

/** Running totals for the current month (not yet on a statement). */
async function Summary({ ctx }: { ctx: PartnerContext }) {
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const { data } = await ctx.supabase
    .from("ledger_entries")
    .select("entry_type, org_id, counterparty_org_id, amount")
    .or(`org_id.eq.${ctx.orgId},counterparty_org_id.eq.${ctx.orgId}`)
    .gte("created_at", `${monthStart}T00:00:00Z`)
    .limit(10000);
  const t = totals(ctx.orgId, (data ?? []) as Pick<Entry, "entry_type" | "org_id" | "counterparty_org_id" | "amount">[]);
  const cards =
    ctx.kind === "broker"
      ? [
          { label: "Commission earned", value: t.commissionEarned, hint: "Paid by insurers out of premiums" },
          { label: "Revenue share to Covva", value: t.feesOwed, hint: "On Covva-sourced business only" },
          { label: "Net due to you", value: t.net, hint: "Settled with the monthly statement" },
        ]
      : [
          { label: "Premiums received", value: t.premiums, hint: "Settled directly to your account" },
          { label: "Commission payable", value: t.commissionPayable, hint: "Broker commission out of premiums" },
          { label: "Platform fees", value: t.feesOwed, hint: "Covva fee on Covva-sourced business" },
        ];
  return (
    <Section title="This month so far" description={`Since ${formatDate(monthStart)} — ledger entries not yet on a statement`} tone="mist">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatGHS(c.value, { decimals: true })}</p>
            <p className="text-xs text-subtle">{c.hint}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function totals(orgId: string, entries: Pick<Entry, "entry_type" | "org_id" | "counterparty_org_id" | "amount">[]) {
  let premiums = 0;
  let commissionEarned = 0;
  let commissionPayable = 0;
  let feesOwed = 0;
  for (const e of entries) {
    const a = Number(e.amount);
    if (e.entry_type === "premium_received" || e.entry_type === "premium_to_insurer" || e.entry_type === "refund") {
      if (e.org_id === orgId) premiums += a;
    } else if (e.entry_type === "broker_commission") {
      if (e.org_id === orgId) commissionEarned += a;
      else if (e.counterparty_org_id === orgId) commissionPayable += a;
    } else if (e.counterparty_org_id === orgId) feesOwed += a;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { premiums: r(premiums), commissionEarned: r(commissionEarned), commissionPayable: r(commissionPayable), feesOwed: r(feesOwed), net: r(commissionEarned - commissionPayable - feesOwed) };
}

async function Detail({ ctx, statement: s }: { ctx: PartnerContext; statement: Statement }) {
  const { data: lines } = await ctx.supabase.from("settlement_lines").select("ledger_entry_id, entry:ledger_entries(*)").eq("statement_id", s.id).limit(5000);
  const entries = (lines ?? []).map((l) => l.entry as unknown as Entry | null).filter((e): e is Entry => !!e).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const names = await getOrgNames(ctx, entries.flatMap((e) => [e.org_id, e.counterparty_org_id]));
  const broker = ctx.kind === "broker";
  const net = Number(s.net_due);
  return (
    <Section
      title={`Statement ${formatDate(s.period_start)} – ${formatDate(s.period_end)}`}
      description={s.issued_at ? `Issued ${formatDateTime(s.issued_at)}${s.paid_at ? ` · paid ${formatDateTime(s.paid_at)}` : ""}` : "Draft — figures may change until the platform issues it."}
      actions={<Pill tone={STATUS_TONE[s.status as keyof typeof STATUS_TONE] ?? "neutral"}>{humanize(s.status)}</Pill>}
    >
      <div className="mb-4 max-w-md">
        {broker ? (
          <>
            <KV label="Commission earned">{formatGHS(Number(s.commission), { decimals: true })}</KV>
            <KV label="Revenue share to Covva">{formatGHS(Number(s.platform_fee), { decimals: true })}</KV>
          </>
        ) : (
          <>
            <KV label="Premiums received">{formatGHS(Number(s.gross_premium), { decimals: true })}</KV>
            <KV label="Broker commission payable">{formatGHS(Math.abs(Number(s.commission)), { decimals: true })}</KV>
            <KV label="Platform fees">{formatGHS(Number(s.platform_fee), { decimals: true })}</KV>
          </>
        )}
        <KV label={net >= 0 ? "Net due to you" : "Net you owe"}>{formatGHS(Math.abs(net), { decimals: true })}</KV>
        <KV label="Lines">{s.line_count}</KV>
      </div>
      {entries.length === 0 ? (
        <Empty>No ledger lines in this period.</Empty>
      ) : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Entry</Th><Th>Counterparty</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></THead>
          <tbody>
            {entries.map((e) => {
              const credit = e.org_id === ctx.orgId;
              const other = credit ? e.counterparty_org_id : e.org_id;
              const amount = Number(e.amount) * (credit ? 1 : -1);
              return (
                <tr key={e.id}>
                  <Td className="text-xs">{formatDate(e.created_at)}</Td>
                  <Td><span className="font-medium text-ink">{ENTRY_LABEL[e.entry_type] ?? humanize(e.entry_type)}</span>{e.memo && <span className="block text-xs text-muted">{e.memo}</span>}</Td>
                  <Td className="text-xs">{other ? names.get(other) ?? "—" : "Customer"}</Td>
                  <Td className="text-xs"><code>{e.reference ?? "—"}</code></Td>
                  <Td className={`text-right tabular-nums ${amount < 0 ? "text-danger" : "text-ink"}`}>{amount < 0 ? "−" : ""}{formatGHS(Math.abs(amount), { decimals: true })}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-muted">Premiums are paid by customers directly to the insurer. Commission and platform fees are paid out of the premium; Covva never holds client funds.</p>
    </Section>
  );
}
