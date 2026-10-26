import "server-only";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { platformOrgId, sourceOf, splitTermsFor, type SplitSummary } from "@/server/commercial";
import { computeSplit } from "@im/core";

/**
 * Money ledger (append-only) and settlement statements. Every entry is a credit to
 * `org_id` and, when set, a debit to `counterparty_org_id`:
 *
 *   premium_received   insurer  ← customer           (the premium, settled to the insurer)
 *   broker_commission  broker   ← insurer            (commission, paid out of the premium)
 *   platform_fee       platform ← insurer            (insurer-side fee on Covva-sourced business)
 *   revenue_share      platform ← broker             (Covva's share of the broker's commission)
 *
 * Posting is idempotent: one entry per (payment_id, entry_type). The DB forbids
 * updates and deletes (ledger_entries_no_update), so corrections are `adjustment` rows.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type LedgerEntry = Row<"ledger_entries">;
export type LedgerEntryType = LedgerEntry["entry_type"];

export interface LedgerEntryInput {
  entry_type: "premium_received" | "premium_to_insurer" | "broker_commission" | "platform_fee" | "revenue_share" | "subscription_fee" | "refund" | "adjustment";
  org_id: string;
  amount: number;
  counterparty_org_id?: string | null;
  payment_id?: string | null;
  policy_id?: string | null;
  currency?: string;
  memo?: string | null;
  reference?: string | null;
}

/** Insert entries one by one; a duplicate (payment_id, entry_type) is treated as already posted. */
export async function recordLedgerEntries(svc: Svc, entries: LedgerEntryInput[]): Promise<{ posted: number; skipped: number }> {
  let posted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!(Math.abs(e.amount) > 0) && e.entry_type !== "adjustment") {
      skipped++;
      continue;
    }
    const { error } = await svc.from("ledger_entries").insert({
      entry_type: e.entry_type,
      org_id: e.org_id,
      counterparty_org_id: e.counterparty_org_id ?? null,
      payment_id: e.payment_id ?? null,
      policy_id: e.policy_id ?? null,
      amount: Math.round(e.amount * 100) / 100,
      currency: e.currency ?? "GHS",
      memo: e.memo ?? null,
      reference: e.reference ?? null,
    });
    if (!error) posted++;
    else if (error.code === "23505") skipped++;
    else {
      log.error("ledger.post_failed", { entry: e, err: error });
      throw new Error(error.message);
    }
  }
  return { posted, skipped };
}

function asObject(v: Json | null | undefined): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Split summary stored at initiation, or recomputed from the terms in force for older payments. */
async function splitSummaryFor(svc: Svc, payment: Row<"payments">): Promise<SplitSummary | null> {
  const stored = asObject(payment.raw_event).split as SplitSummary | undefined;
  if (stored && typeof stored === "object" && typeof stored.insurer_org_id === "string") return stored;
  if (!payment.quote_id) return null;
  const [{ data: quote }, { data: request }] = await Promise.all([
    svc.from("quotes").select("id, premium, taxes, fees, currency, insurer_org_id, broker_org_id").eq("id", payment.quote_id).maybeSingle(),
    svc.from("requests").select("broker_org_id, source_broker_org_id").eq("id", payment.request_id).maybeSingle(),
  ]);
  if (!quote || !request) return null;
  const brokerOrgId = request.broker_org_id ?? quote.broker_org_id ?? null;
  const terms = await splitTermsFor(svc, quote.insurer_org_id, brokerOrgId, (payment.paid_at ?? payment.created_at).slice(0, 10));
  const taxes = Number(quote.taxes) || 0;
  const fees = Number(quote.fees) || 0;
  const source = sourceOf(request);
  const s = computeSplit({ premium: Math.max(0, Number(payment.amount) - taxes - fees), taxes, fees, source, terms });
  return {
    source,
    total: s.total,
    insurer: s.insurer,
    broker: s.broker,
    platform: s.platform,
    broker_commission: s.brokerCommission,
    revenue_share: s.revenueShare,
    platform_fee: s.platformFee,
    insurer_org_id: quote.insurer_org_id,
    broker_org_id: brokerOrgId,
    platform_org_id: await platformOrgId(svc),
    split_code: null,
    terms,
  };
}

/**
 * Post the ledger entries for a succeeded premium payment (idempotent). Called from
 * `applyPaymentResult`; never throws into the payment flow — failures are logged and
 * can be re-posted by calling again.
 */
export async function recordPaymentLedger(svc: Svc, payment: Row<"payments">): Promise<{ posted: number; skipped: number } | null> {
  try {
    if (payment.status !== "succeeded") return null;
    const s = await splitSummaryFor(svc, payment);
    if (!s) {
      log.warn("ledger.no_split", { paymentId: payment.id });
      return null;
    }
    const ref = payment.provider_reference ?? payment.id;
    const base = { payment_id: payment.id, policy_id: payment.policy_id, currency: payment.currency, reference: ref };
    const entries: LedgerEntryInput[] = [
      {
        ...base,
        entry_type: "premium_received",
        org_id: payment.payee_org_id,
        amount: Number(payment.amount),
        // Diaspora: the ledger is always GHS (the insurer's amount); the payer's display currency is a memo only.
        memo: `Premium received from customer (${s.source}-sourced)${payment.display_currency && payment.display_currency !== "GHS" ? ` · fx: shown as ${payment.display_currency} ${Number(payment.display_amount ?? 0).toFixed(2)} at ${Number(payment.fx_rate ?? 0)} GHS/${payment.display_currency} (${payment.fx_source ?? "unknown"}, indicative)` : ""}`,
      },
    ];
    if (s.broker_org_id && s.broker_commission > 0) {
      entries.push({ ...base, entry_type: "broker_commission", org_id: s.broker_org_id, counterparty_org_id: s.insurer_org_id, amount: s.broker_commission, memo: `Broker commission ${s.terms.brokerCommissionPct}% of net premium, paid by the insurer` });
    }
    if (s.platform_org_id && s.platform_fee > 0) {
      entries.push({ ...base, entry_type: "platform_fee", org_id: s.platform_org_id, counterparty_org_id: s.insurer_org_id, amount: s.platform_fee, memo: `Platform fee ${s.terms.platformFeePct}% of net premium, paid by the insurer` });
    }
    if (s.platform_org_id && s.broker_org_id && s.revenue_share > 0) {
      entries.push({ ...base, entry_type: "revenue_share", org_id: s.platform_org_id, counterparty_org_id: s.broker_org_id, amount: s.revenue_share, memo: `Revenue share ${s.terms.revenueSharePct}% of broker commission (Covva-sourced)` });
    }
    const result = await recordLedgerEntries(svc, entries);
    // With a Paystack split group the parties were paid at source; otherwise the shares
    // stay pending until the settlement statement is paid.
    if (s.split_code) {
      await svc.from("payment_splits").update({ status: "settled", settled_at: payment.paid_at ?? new Date().toISOString() }).eq("payment_id", payment.id).eq("status", "pending");
    }
    return result;
  } catch (err) {
    log.error("ledger.record_payment_failed", { paymentId: payment.id, err });
    return null;
  }
}

/**
 * Post the reversal entries for a refunded premium payment (idempotent). One `refund` row credits
 * the insurer with −premium; the commission / fee / revenue-share rows are reversed as `adjustment`
 * rows (negative amounts, same parties) referenced `<payment reference>:refund`. Never throws into
 * the refund flow — failures are logged and the call can be repeated.
 */
export async function recordRefundLedger(svc: Svc, payment: Row<"payments">, reason?: string | null): Promise<{ posted: number; skipped: number } | null> {
  try {
    const { data: existing } = await svc
      .from("ledger_entries")
      .select("id, entry_type, org_id, counterparty_org_id, amount, memo, reference")
      .eq("payment_id", payment.id)
      .limit(50);
    const rows = existing ?? [];
    if (rows.some((r) => r.entry_type === "refund")) return { posted: 0, skipped: rows.length };
    const premium = rows.find((r) => r.entry_type === "premium_received");
    const ref = `${payment.provider_reference ?? payment.id}:refund`;
    const why = reason ? ` — ${reason}` : "";
    const base = { payment_id: payment.id, policy_id: payment.policy_id, currency: payment.currency, reference: ref };
    const entries: LedgerEntryInput[] = [
      { ...base, entry_type: "refund", org_id: payment.payee_org_id, amount: -Math.abs(Number(premium?.amount ?? payment.amount)), memo: `Premium refunded to the customer${why}` },
    ];
    for (const r of rows) {
      if (r.entry_type !== "broker_commission" && r.entry_type !== "platform_fee" && r.entry_type !== "revenue_share") continue;
      entries.push({ ...base, entry_type: "adjustment", org_id: r.org_id, counterparty_org_id: r.counterparty_org_id, amount: -Math.abs(Number(r.amount)), memo: `Reversal of ${r.entry_type.replace(/_/g, " ")} (refund)` });
    }
    return await recordLedgerEntries(svc, entries);
  } catch (err) {
    log.error("ledger.record_refund_failed", { paymentId: payment.id, err });
    return null;
  }
}

/** Build (or refresh while draft) an organisation's settlement statement for a period. Returns its id. */
export async function buildSettlementStatement(svc: Svc, orgId: string, periodStart: string, periodEnd: string): Promise<string> {
  const { data, error } = await svc.rpc("build_settlement_statement", { p_org: orgId, p_start: periodStart, p_end: periodEnd });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Calendar month before `now`, as inclusive ISO dates. */
export function previousMonth(now = new Date()): { start: string; end: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/** Draft statements for every organisation with ledger activity in the period (idempotent). */
export async function buildStatementsForPeriod(svc: Svc, start: string, end: string): Promise<{ orgs: number; statements: string[] }> {
  const { data: rows } = await svc
    .from("ledger_entries")
    .select("org_id, counterparty_org_id")
    .gte("created_at", `${start}T00:00:00Z`)
    .lt("created_at", `${nextDay(end)}T00:00:00Z`)
    .limit(50000);
  const platform = await platformOrgId(svc);
  const orgs = new Set<string>();
  for (const r of rows ?? []) {
    if (r.org_id !== platform) orgs.add(r.org_id);
    if (r.counterparty_org_id && r.counterparty_org_id !== platform) orgs.add(r.counterparty_org_id);
  }
  const statements: string[] = [];
  for (const orgId of orgs) {
    try {
      statements.push(await buildSettlementStatement(svc, orgId, start, end));
    } catch (err) {
      log.error("ledger.statement_failed", { orgId, start, end, err });
    }
  }
  return { orgs: orgs.size, statements };
}

function nextDay(iso: string) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
