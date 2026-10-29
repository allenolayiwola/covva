import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Pill, StatusPill, Tabs, buttonClass, Notice } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { PAYMENT_STATUS, type PaymentStatus } from "@im/core";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, isUuid, orgMap, pageOf, sp, withParams, type SearchParams } from "@/lib/query";
import { EXCEPTION_LABEL, findPaymentExceptions, PAYMENT_COLUMNS, type PaymentRow } from "@/lib/payments";
import { formatDateTime, formatGHS } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { setReconciled } from "./actions";

const CHANNELS: Enum<"payment_channel">[] = ["mobile_money", "card", "bank_transfer", "ussd"];

export default function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  return (
    <>
      <PageHeader
        title="Payments"
        description="Premiums are paid through the payment provider directly to the insurer. The platform never holds premium money — this is a reconciliation view."
      />
      <Suspense fallback={<LoadingBlock label="Loading payments…" />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Payments({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const orgs = await orgMap(supabase);
  const view = sp(params, "view") === "exceptions" ? "exceptions" : "all";
  const canAct = can(staff.roles, "operations");
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer");

  const tabs = (
    <Tabs
      className="mb-4 w-fit"
      active={view}
      items={[
        { key: "all", label: "All payments", href: "/payments" },
        { key: "exceptions", label: "Exceptions", href: "/payments?view=exceptions" },
      ]}
    />
  );

  if (view === "exceptions") {
    const exceptions = await findPaymentExceptions(supabase);
    return (
      <>
        {tabs}
        <ReadOnlyBanner show={!canAct} />
        <Notice tone="info" className="mb-4">
          Unreconciled payments that succeeded more than 48 hours ago with no policy, failed or reversed payments, and amounts that differ
          from the quote premium. Marking a payment reconciled (with a note) clears it from this list.
        </Notice>
        <PaymentTable rows={exceptions.map((e) => ({ ...e.payment, kinds: e.kinds, expected: e.expected }))} orgs={orgs} canAct={canAct} />
      </>
    );
  }

  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const reconciled = sp(params, "reconciled");
  const payee = sp(params, "payee");
  const channel = sp(params, "channel");
  const q = sp(params, "q");

  let query = supabase.from("payments").select(PAYMENT_COLUMNS, { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (status && status in PAYMENT_STATUS) query = query.eq("status", status as PaymentStatus);
  if (reconciled === "yes") query = query.eq("reconciled", true);
  if (reconciled === "no") query = query.eq("reconciled", false);
  if (payee) query = query.eq("payee_org_id", payee);
  if (channel && (CHANNELS as string[]).includes(channel)) query = query.eq("channel", channel as Enum<"payment_channel">);
  if (q) query = isUuid(q) ? query.or(`id.eq.${q},request_id.eq.${q}`) : query.ilike("provider_reference", ilikeTerm(q));
  const { data, count, error } = await query;

  return (
    <>
      {tabs}
      <FilterBar action="/payments">
        <FilterInput name="q" label="Provider ref or id" value={q} />
        <FilterSelect name="status" label="Status" value={status} options={Object.entries(PAYMENT_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="reconciled" label="Reconciled" value={reconciled} options={[{ value: "yes", label: "Reconciled" }, { value: "no", label: "Not reconciled" }]} />
        <FilterSelect name="payee" label="Payee insurer" value={payee} options={insurers.map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect name="channel" label="Channel" value={channel} options={CHANNELS.map((c) => ({ value: c, label: c.replace("_", " ") }))} />
        <a href={withParams("/payments/export", params, {})} className={buttonClass("outline", "sm", "ml-auto")} download>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <ReadOnlyBanner show={!canAct} />
      <PaymentTable rows={(data ?? []) as PaymentRow[]} orgs={orgs} canAct={canAct} />
      <Pagination base="/payments" params={params} page={page} total={count} />
    </>
  );
}

function PaymentTable({
  rows,
  orgs,
  canAct,
}: {
  rows: (PaymentRow & { kinds?: (keyof typeof EXCEPTION_LABEL)[]; expected?: number | null })[];
  orgs: Map<string, { name: string }>;
  canAct: boolean;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <Th>Provider ref</Th>
          <Th>Status</Th>
          <Th>Amount</Th>
          <Th>Payee insurer</Th>
          <Th>Channel</Th>
          <Th>Paid</Th>
          <Th>Reconciliation</Th>
          <Th />
        </tr>
      </THead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="align-top">
            <Td>
              <p className="font-mono text-xs text-ink">{p.provider_reference ?? "—"}</p>
              <p className="text-xs text-muted">{p.provider} · <Link href={`/requests/${p.request_id}`} className="text-brand hover:underline">request</Link></p>
              {p.kinds?.map((k) => (
                <Pill key={k} tone={k === "failed" ? "danger" : "wait"} className="mr-1 mt-1">{EXCEPTION_LABEL[k]}</Pill>
              ))}
            </Td>
            <Td><StatusPill meta={PAYMENT_STATUS[p.status]} />{p.failure_reason && <p className="mt-1 text-xs text-danger">{p.failure_reason}</p>}</Td>
            <Td className="tabular-nums">
              {formatGHS(Number(p.amount), { decimals: true })}
              {p.expected != null && Math.abs(p.expected - Number(p.amount)) > 0.009 && (
                <p className="text-xs text-amber">Quote: {formatGHS(p.expected, { decimals: true })}</p>
              )}
            </Td>
            <Td>{orgs.get(p.payee_org_id)?.name ?? "—"}</Td>
            <Td className="capitalize">{p.channel?.replace("_", " ") ?? "—"}</Td>
            <Td className="whitespace-nowrap">{formatDateTime(p.paid_at)}</Td>
            <Td>{p.reconciled ? <><Pill tone="ok">Reconciled</Pill><p className="mt-1 text-xs text-muted">{formatDateTime(p.reconciled_at)}</p></> : <Pill tone="neutral">Open</Pill>}</Td>
            <Td className="text-right">
              <ConfirmAction
                action={setReconciled}
                fields={{ paymentId: p.id, value: p.reconciled ? "false" : "true" }}
                label={p.reconciled ? "Unreconcile" : "Reconcile"}
                title={p.reconciled ? "Mark payment unreconciled" : "Mark payment reconciled"}
                variant={p.reconciled ? "danger" : "primary"}
                reasonLabel="Reconciliation note"
                confirmLabel={p.reconciled ? "Mark unreconciled" : "Mark reconciled"}
                disabled={!canAct}
                body="Confirm the provider settlement report matches this payment (amount, payee insurer subaccount, reference). This does not move money."
              />
            </Td>
          </tr>
        ))}
        {!rows.length && <tr><Td colSpan={8} className="py-10 text-center text-muted">No payments.</Td></tr>}
      </tbody>
    </Table>
  );
}
