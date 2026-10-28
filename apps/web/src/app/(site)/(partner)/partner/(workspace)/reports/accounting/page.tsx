import type { Metadata } from "next";
import { Suspense } from "react";
import { ACCOUNTING_EXPORT_LABEL, formatDateTime } from "@im/core";
import { Notice, PageHeader, Pill, Table, Td, Th, THead } from "@im/ui";
import { EXPORTS_FOR } from "@/server/accounting";
import { ROLES, can, getPartnerContext } from "../../../_lib/context";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Accounting exports" };

/**
 * Accounting exports for insurers and brokers (owners, admins and finance): insurer statement,
 * commission report, tax report and journal CSVs for Xero, QuickBooks Online and Sage 50.
 */
export default function AccountingReportsPage() {
  return (
    <>
      <PageHeader title="Accounting exports" description="Download statements, commission and tax reports, or journals for your accounting software, built from the Covva ledger." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Exports />
      </Suspense>
    </>
  );
}

async function Exports() {
  const ctx = await getPartnerContext();
  if (!can(ctx, ROLES.billing)) return <Notice tone="info">Accounting exports are available to owners, admins and finance.</Notice>;
  if (ctx.kind !== "broker" && ctx.kind !== "insurer") return <Notice tone="info">Accounting exports are for brokers and insurers.</Notice>;
  const kinds = EXPORTS_FOR[ctx.kind];
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
  const { data: recent } = await ctx.supabase.from("accounting_exports").select("id, kind, period_start, period_end, status, row_count, created_at").eq("org_id", ctx.orgId).order("created_at", { ascending: false }).limit(20);
  return (
    <div className="space-y-6">
      <Section title="Download" description="Choose the report and the month. Files are generated now from the ledger and the link expires after 10 minutes.">
        <form action="/partner/reports/accounting/download" method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink">Report</span>
            <select name="kind" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" defaultValue={kinds[0]}>
              {kinds.map((k) => <option key={k} value={k}>{ACCOUNTING_EXPORT_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink">Month</span>
            <select name="month" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" defaultValue={months[1]?.value}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <button type="submit" className="h-10 rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-deep">Download CSV</button>
        </form>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
          {ctx.kind === "insurer" && <li>Insurer statement: premiums your customers paid you directly, refunds, and the commission and platform fees payable out of them.</li>}
          <li>Commission report: commission by {ctx.kind === "insurer" ? "broker" : "insurer"}, reversals on refunds{ctx.kind === "broker" ? " and Covva's revenue share" : ""}.</li>
          <li>Tax report: VAT and levy lines for rules your finance team has confirmed. Rules awaiting confirmation are listed but not applied.</li>
          <li>Xero / QuickBooks / Sage: balanced double-entry journals with a default chart of accounts — map the codes to yours after import.</li>
        </ul>
      </Section>
      <Section title="Recent exports">
        {!recent?.length ? (
          <Empty>No exports yet.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Report</Th><Th>Period</Th><Th>Rows</Th><Th>Status</Th><Th>Created</Th><Th>&nbsp;</Th></tr></THead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <Td>{ACCOUNTING_EXPORT_LABEL[r.kind as keyof typeof ACCOUNTING_EXPORT_LABEL] ?? r.kind}</Td>
                  <Td>{r.period_start} – {r.period_end}</Td>
                  <Td>{r.row_count ?? "—"}</Td>
                  <Td><Pill tone={r.status === "ready" ? "ok" : r.status === "failed" ? "danger" : "wait"}>{r.status}</Pill></Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
                  <Td>{r.status === "ready" && <a href={`/partner/reports/accounting/download?id=${r.id}`} className="text-sm font-semibold text-brand hover:underline">Download</a>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
