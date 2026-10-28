import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReceiptText } from "lucide-react";
import { INVOICE_STATUS, businessCan, formatDate, formatGHS, humanize } from "@im/core";
import { Card, EmptyState, Field, Input, Notice, PageHeader, Pill, Select, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { invoiceLines, listInvoices } from "@/server/business";
import { payInvoiceAction } from "../actions";
import { BusinessNav, businessContext } from "../_lib";

export const metadata: Metadata = { title: "Business statements" };

export default function InvoicesPage({ searchParams }: PageProps<"/account/business/invoices">) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Statements"
        description="One consolidated statement a month for every policy. You pay each insurer's line separately — the money goes straight to that insurer. Covva never holds your premiums."
      />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function PayForm({ invoiceId, insurerOrgId, label }: { invoiceId: string; insurerOrgId?: string; label: string }) {
  return (
    <ActionForm action={payInvoiceAction} submitLabel={label} size="sm" className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {insurerOrgId && <input type="hidden" name="insurerOrgId" value={insurerOrgId} />}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Pay by" htmlFor={`ch-${invoiceId}-${insurerOrgId ?? "all"}`}>
          <Select id={`ch-${invoiceId}-${insurerOrgId ?? "all"}`} name="channel" defaultValue="mobile_money" className="h-9 text-sm">
            <option value="mobile_money">Mobile money</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
          </Select>
        </Field>
        <Field label="MoMo number" htmlFor={`ph-${invoiceId}-${insurerOrgId ?? "all"}`}>
          <Input id={`ph-${invoiceId}-${insurerOrgId ?? "all"}`} name="phone" type="tel" inputMode="tel" className="h-9 text-sm" placeholder="024 123 4567" />
        </Field>
        <Field label="Network" htmlFor={`nw-${invoiceId}-${insurerOrgId ?? "all"}`}>
          <Select id={`nw-${invoiceId}-${insurerOrgId ?? "all"}`} name="network" defaultValue="" className="h-9 text-sm">
            <option value="">—</option>
            <option value="mtn">MTN MoMo</option>
            <option value="vod">Telecel Cash</option>
            <option value="atl">AirtelTigo Money</option>
          </Select>
        </Field>
      </div>
    </ActionForm>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business/invoices", sp);
  if (!current) return <EmptyState title="No business account" body="Create a business account first." action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>} />;
  const invoices = await listInvoices(ctx, current.orgId);
  const canPay = businessCan(current.role, "billing");
  return (
    <>
      <BusinessNav current={current} accounts={accounts} active="invoices" />
      {!canPay && <Notice tone="info">Your role ({current.role}) can view statements. Owners, admins and finance pay them.</Notice>}
      {invoices.length === 0 ? (
        <EmptyState icon={<ReceiptText className="size-5" />} title="No statements yet" body="Statements are prepared on the 1st of each month for the previous month: new cover awaiting payment, premiums and instalments due." />
      ) : (
        invoices.map((inv) => {
          const lines = invoiceLines(inv);
          const byInsurer = new Map<string, { name: string | null; amount: number; open: number }>();
          for (const l of lines) {
            const b = byInsurer.get(l.insurer_org_id) ?? { name: l.insurer_name, amount: 0, open: 0 };
            b.amount += l.amount;
            if (l.payment_status !== "succeeded") b.open++;
            byInsurer.set(l.insurer_org_id, b);
          }
          const meta = INVOICE_STATUS[inv.status as keyof typeof INVOICE_STATUS] ?? INVOICE_STATUS.issued;
          return (
            <Card as="section" key={inv.id} className="space-y-4 p-5" aria-label={`Statement ${inv.reference}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{inv.reference} · {formatDate(inv.period_start)} – {formatDate(inv.period_end)}</h2>
                  <p className="text-sm text-muted">Total {formatGHS(Number(inv.total), { decimals: true })}{inv.due_at ? ` · due ${formatDate(inv.due_at)}` : ""}{inv.paid_at ? ` · paid ${formatDate(inv.paid_at)}` : ""}</p>
                </div>
                <Pill tone={meta.tone}>{meta.label}</Pill>
              </div>
              <Table>
                <THead><tr><Th>Item</Th><Th>Insurer</Th><Th>Basis</Th><Th>Amount</Th><Th>Payment</Th></tr></THead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.insurer_org_id}-${l.policy_id ?? l.application_id ?? i}-${l.instalment_id ?? ""}`}>
                      <Td className="text-ink">{l.description}</Td>
                      <Td>{l.insurer_name ?? "Insurer"}</Td>
                      <Td className="text-xs text-muted">{humanize(l.basis ?? "premium")}</Td>
                      <Td className="tabular-nums">{formatGHS(l.amount, { decimals: true })}</Td>
                      <Td>{l.payment_status ? <Pill tone={l.payment_status === "succeeded" ? "ok" : l.payment_status === "failed" ? "danger" : "wait"}>{humanize(l.payment_status)}</Pill> : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {canPay && inv.status !== "paid" && (
                <div className="space-y-4 border-t border-line pt-4">
                  <h3 className="text-sm font-semibold text-ink">Pay by insurer</h3>
                  {[...byInsurer.entries()].filter(([, b]) => b.open > 0).map(([insurerId, b]) => (
                    <div key={insurerId} className="rounded-xl bg-mist p-3">
                      <p className="mb-2 text-sm text-ink">{b.name ?? "Insurer"} · {formatGHS(b.amount, { decimals: true })} — paid directly to {b.name ?? "the insurer"}</p>
                      <PayForm invoiceId={inv.id} insurerOrgId={insurerId} label={`Pay ${b.name ?? "insurer"}`} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })
      )}
    </>
  );
}
