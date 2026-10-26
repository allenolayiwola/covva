import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LogoMark, Pill } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import type { InvoiceLine } from "@/lib/billing";
import { Breadcrumb, LoadingBlock } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { transitionInvoice } from "../actions";
import { INVOICE_TONE } from "../meta";
import { PrintButton } from "./PrintButton";

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading invoice…" />}>
      <Invoice params={params} />
    </Suspense>
  );
}

async function Invoice({ params }: Pick<PageProps<"/invoices/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const [{ data: org }, { data: brand }] = await Promise.all([
    supabase.from("organizations").select("name, legal_name, address, region, contact_email, registration_number").eq("id", inv.org_id).single(),
    supabase.from("platform_settings").select("value").eq("key", "brand").maybeSingle(),
  ]);
  const { data: platform } = await supabase.from("organizations").select("legal_name, address, contact_email").eq("type", "platform").limit(1).maybeSingle();
  const b = (brand?.value as { name?: string; support_email?: string } | null) ?? {};
  const lines = ((inv.lines as unknown as InvoiceLine[]) ?? []).filter((l) => l.code !== "void_note");
  const voidNote = ((inv.lines as unknown as InvoiceLine[]) ?? []).find((l) => l.code === "void_note");
  const canAct = can(staff.roles, "commercial");
  const money = (n: number) => formatGHS(n, { decimals: true });

  return (
    <>
      <div className="no-print">
        <Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: inv.number }]} />
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <PrintButton />
          {inv.status === "draft" && (
            <ActionForm action={transitionInvoice} inline submitLabel="Issue invoice" readOnly={!canAct}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input type="hidden" name="to" value="issued" />
              <label className="text-sm text-muted">Due in <input name="dueDays" type="number" defaultValue={14} min={0} max={120} className="h-9 w-16 rounded-[10px] border border-line px-2" /> days</label>
            </ActionForm>
          )}
          {(inv.status === "issued" || inv.status === "overdue") && (
            <ActionForm action={transitionInvoice} inline submitLabel="Mark paid" readOnly={!canAct}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input type="hidden" name="to" value="paid" />
            </ActionForm>
          )}
          {inv.status === "issued" && (
            <ActionForm action={transitionInvoice} inline submitLabel="Mark overdue" submitVariant="outline" readOnly={!canAct}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input type="hidden" name="to" value="overdue" />
            </ActionForm>
          )}
          {inv.status !== "paid" && inv.status !== "void" && (
            <ConfirmAction action={transitionInvoice} fields={{ invoiceId: inv.id, to: "void" }} label="Void" title={`Void ${inv.number}`} confirmLabel="Void invoice" confirmWord="VOID" disabled={!canAct} body="Voided invoices are kept for the record and can't be reissued. Generate a new draft for the period afterwards if needed." />
          )}
        </div>
      </div>

      <article className="print-area mx-auto max-w-3xl rounded-card border border-line bg-white p-8 shadow-card sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <LogoMark size={40} />
            <div>
              <p className="text-lg font-semibold text-ink">{b.name ?? "Insurance Marketplace"}</p>
              <p className="text-xs text-muted">{platform?.legal_name ?? ""}</p>
              <p className="text-xs text-muted">{platform?.address ?? ""}</p>
              <p className="text-xs text-muted">{b.support_email ?? platform?.contact_email ?? ""}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight text-ink">Invoice</p>
            <p className="font-mono text-sm text-ink-2">{inv.number}</p>
            <Pill tone={INVOICE_TONE[inv.status]} className="mt-1">{inv.status}</Pill>
          </div>
        </header>
        <section className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bill to</p>
            <p className="mt-1 font-semibold text-ink">{org?.legal_name ?? org?.name}</p>
            {org?.registration_number && <p className="text-muted">Reg. {org.registration_number}</p>}
            {org?.address && <p className="text-muted">{org.address}</p>}
            {org?.region && <p className="text-muted">{org.region}</p>}
            {org?.contact_email && <p className="text-muted">{org.contact_email}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:text-right">
            <dt className="text-muted">Period</dt><dd>{formatDate(inv.period_start)} – {formatDate(inv.period_end)}</dd>
            <dt className="text-muted">Issued</dt><dd>{formatDate(inv.issued_at)}</dd>
            <dt className="text-muted">Due</dt><dd>{formatDate(inv.due_on)}</dd>
            {inv.paid_at && (<><dt className="text-muted">Paid</dt><dd>{formatDate(inv.paid_at)}</dd></>)}
          </dl>
        </section>
        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <tr><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2.5 pr-4 text-ink-2">{l.description}</td>
                <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2.5 text-right tabular-nums">{money(l.unit_price)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr><td colSpan={3} className="pt-3 text-right text-muted">Subtotal</td><td className="pt-3 text-right tabular-nums">{money(Number(inv.subtotal))}</td></tr>
            <tr><td colSpan={3} className="pt-1 text-right text-muted">Tax</td><td className="pt-1 text-right tabular-nums">{money(Number(inv.tax))}</td></tr>
            <tr><td colSpan={3} className="pt-2 text-right font-semibold text-ink">Total ({inv.currency})</td><td className="pt-2 text-right text-lg font-bold tabular-nums text-ink">{money(Number(inv.total))}</td></tr>
          </tfoot>
        </table>
        {voidNote && <p className="mt-6 rounded-lg bg-danger-bg p-3 text-sm text-danger">{voidNote.description}</p>}
        <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
          Technology services fees only. {b.name ?? "Insurance Marketplace"} is a technology provider — not an insurer or broker — and does not collect or hold
          insurance premiums, which are paid directly to insurers.
        </footer>
      </article>
    </>
  );
}
