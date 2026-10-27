/**
 * Accounting exports (Roadmap Phase 3; Addendum 2 F): insurer statements, commission reports,
 * VAT / levy lines and journal CSVs for Xero, QuickBooks Online and Sage 50.
 *
 * Money rules kept from the ledger: premiums settle to the INSURER (Covva never holds them);
 * commission and platform fees are paid by the insurer out of the premium. Everything here is
 * pure and computed in pesewas so totals are exact.
 *
 * Tax: rates are NOT hard-coded. `applyTaxRules` only applies rules whose status is `active` and
 * that have a confirmed rate; `needs_confirmation` and `retired` rules are reported as skipped.
 */

export const TAX_APPLIES_TO = ["platform_fee", "broker_commission", "premium", "subscription"] as const;
export type TaxAppliesTo = (typeof TAX_APPLIES_TO)[number];
export const TAX_RULE_STATUSES = ["needs_confirmation", "active", "retired"] as const;
export type TaxRuleStatus = (typeof TAX_RULE_STATUSES)[number];

export interface TaxRuleLike {
  id?: string;
  code: string;
  name?: string | null;
  applies_to: TaxAppliesTo | string;
  /** Percentage, e.g. 15 = 15 %. Null until confirmed. */
  rate: number | string | null;
  inclusive: boolean;
  effective_from: string;
  effective_to?: string | null;
  status: TaxRuleStatus | string;
}

export interface TaxLine { code: string; ruleId?: string; base: number; rate: number; inclusive: boolean; amount: number }
export interface TaxResult {
  lines: TaxLine[];
  /** Sum of tax lines. */
  tax: number;
  /** Amount before tax (base minus inclusive tax). */
  net: number;
  /** Amount including tax (base plus exclusive tax). */
  gross: number;
  skipped: { code: string; reason: "needs_confirmation" | "retired" | "no_rate" | "not_in_force" | "other_base" }[];
}

const toMinor = (n: number) => Math.round(n * 100);
const fromMinor = (m: number) => {
  const v = m / 100;
  return Object.is(v, -0) ? 0 : v;
};
/** Half away from zero, in minor units. */
const roundMinor = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
const isoDay = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Applies the tax rules in force on `date` to `base`. Exclusive rules add `base × rate%`; inclusive
 * rules extract `base × rate / (100 + rate)` from a tax-inclusive base. Every line is computed on the
 * original base (levies are not compounded); confirm with the tax adviser if a levy must be compounded.
 * Rules that need confirmation, are retired, have no rate, are outside their dates or apply to another
 * base (when `opts.appliesTo` is set) are skipped.
 */
export function applyTaxRules(base: number, rules: readonly TaxRuleLike[], date: string | Date, opts: { appliesTo?: TaxAppliesTo } = {}): TaxResult {
  const day = isoDay(date);
  const baseMinor = toMinor(base);
  const lines: TaxLine[] = [];
  const skipped: TaxResult["skipped"] = [];
  let exclusive = 0;
  let inclusive = 0;
  for (const r of rules) {
    if (opts.appliesTo && r.applies_to !== opts.appliesTo) {
      skipped.push({ code: r.code, reason: "other_base" });
      continue;
    }
    if (r.status === "needs_confirmation") {
      skipped.push({ code: r.code, reason: "needs_confirmation" });
      continue;
    }
    if (r.status !== "active") {
      skipped.push({ code: r.code, reason: "retired" });
      continue;
    }
    const rate = r.rate === null || r.rate === "" ? NaN : Number(r.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      skipped.push({ code: r.code, reason: "no_rate" });
      continue;
    }
    if (r.effective_from.slice(0, 10) > day || (r.effective_to && r.effective_to.slice(0, 10) < day)) {
      skipped.push({ code: r.code, reason: "not_in_force" });
      continue;
    }
    const minor = r.inclusive ? roundMinor((baseMinor * rate) / (100 + rate)) : roundMinor((baseMinor * rate) / 100);
    if (r.inclusive) inclusive += minor;
    else exclusive += minor;
    lines.push({ code: r.code, ruleId: r.id, base: fromMinor(baseMinor), rate, inclusive: r.inclusive, amount: fromMinor(minor) });
  }
  return { lines, tax: fromMinor(exclusive + inclusive), net: fromMinor(baseMinor - inclusive), gross: fromMinor(baseMinor + exclusive), skipped };
}

/** Which tax base a ledger entry type is (null = not taxed by Covva's rules). */
export function taxBaseForEntry(entryType: string): TaxAppliesTo | null {
  switch (entryType) {
    case "platform_fee":
    case "revenue_share":
      return "platform_fee";
    case "broker_commission":
      return "broker_commission";
    case "premium_received":
    case "premium_to_insurer":
      return "premium";
    case "subscription_fee":
      return "subscription";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Ledger-based reports
// ---------------------------------------------------------------------------
export interface LedgerEntryLike {
  id: number | string;
  created_at: string;
  entry_type: string;
  org_id: string;
  counterparty_org_id: string | null;
  amount: number | string;
  currency: string;
  memo?: string | null;
  reference?: string | null;
  payment_id?: string | null;
  policy_id?: string | null;
}

export const LEDGER_ENTRY_LABEL: Record<string, string> = {
  premium_received: "Premium received",
  premium_to_insurer: "Premium to insurer",
  broker_commission: "Broker commission",
  platform_fee: "Platform fee",
  revenue_share: "Revenue share",
  subscription_fee: "Subscription fee",
  refund: "Refund",
  adjustment: "Adjustment",
};

const isCommissionReversal = (e: LedgerEntryLike) => e.entry_type === "adjustment" && /broker commission/i.test(e.memo ?? "");
const isFeeReversal = (e: LedgerEntryLike) => e.entry_type === "adjustment" && /platform fee/i.test(e.memo ?? "");
const isRevenueShareReversal = (e: LedgerEntryLike) => e.entry_type === "adjustment" && /revenue share/i.test(e.memo ?? "");

export interface CommissionRow {
  brokerOrgId: string;
  insurerOrgId: string | null;
  currency: string;
  entries: number;
  policies: number;
  grossCommission: number;
  reversals: number;
  netCommission: number;
  /** Covva's revenue share owed by the broker on Covva-sourced business. */
  revenueShare: number;
  /** Commission less revenue share: what the broker keeps. */
  brokerNet: number;
}
export interface CommissionReport { rows: CommissionRow[]; totals: Omit<CommissionRow, "brokerOrgId" | "insurerOrgId" | "currency" | "policies"> & { policies: number } }

/**
 * Commission by broker × insurer: commission earned (credit to the broker, debit to the insurer),
 * reversals on refunds, and the revenue share the broker owes Covva. `opts.brokerOrgId` limits it
 * to one broker (a broker's own report); `opts.insurerOrgId` to one insurer (commission payable).
 */
export function commissionReport(entries: readonly LedgerEntryLike[], opts: { brokerOrgId?: string; insurerOrgId?: string } = {}): CommissionReport {
  type Acc = { row: CommissionRow; policies: Set<string>; gross: number; rev: number; revShare: number };
  const map = new Map<string, Acc>();
  const get = (broker: string, insurer: string | null, currency: string) => {
    const key = `${broker}|${insurer ?? ""}|${currency}`;
    let a = map.get(key);
    if (!a) {
      a = { row: { brokerOrgId: broker, insurerOrgId: insurer, currency, entries: 0, policies: 0, grossCommission: 0, reversals: 0, netCommission: 0, revenueShare: 0, brokerNet: 0 }, policies: new Set(), gross: 0, rev: 0, revShare: 0 };
      map.set(key, a);
    }
    return a;
  };
  for (const e of entries) {
    const minor = toMinor(Number(e.amount));
    let a: Acc | null = null;
    if (e.entry_type === "broker_commission" || isCommissionReversal(e)) {
      a = get(e.org_id, e.counterparty_org_id, e.currency);
      if (e.entry_type === "broker_commission") a.gross += minor;
      else a.rev += minor;
    } else if ((e.entry_type === "revenue_share" || isRevenueShareReversal(e)) && e.counterparty_org_id) {
      // Platform ← broker: the broker is the counterparty; insurer unknown at this level.
      a = get(e.counterparty_org_id, null, e.currency);
      a.revShare += minor;
    }
    if (!a) continue;
    a.row.entries++;
    if (e.policy_id) a.policies.add(e.policy_id);
  }
  let rows = [...map.values()].map((a) => ({
    ...a.row,
    policies: a.policies.size,
    grossCommission: fromMinor(a.gross),
    reversals: fromMinor(a.rev),
    netCommission: fromMinor(a.gross + a.rev),
    revenueShare: fromMinor(a.revShare),
    brokerNet: fromMinor(a.gross + a.rev - a.revShare),
  }));
  if (opts.brokerOrgId) rows = rows.filter((r) => r.brokerOrgId === opts.brokerOrgId);
  if (opts.insurerOrgId) rows = rows.filter((r) => r.insurerOrgId === opts.insurerOrgId);
  rows.sort((x, y) => x.brokerOrgId.localeCompare(y.brokerOrgId) || (x.insurerOrgId ?? "").localeCompare(y.insurerOrgId ?? ""));
  const sum = (k: "grossCommission" | "reversals" | "netCommission" | "revenueShare" | "brokerNet") => fromMinor(rows.reduce((s, r) => s + toMinor(r[k]), 0));
  return {
    rows,
    totals: { entries: rows.reduce((s, r) => s + r.entries, 0), policies: rows.reduce((s, r) => s + r.policies, 0), grossCommission: sum("grossCommission"), reversals: sum("reversals"), netCommission: sum("netCommission"), revenueShare: sum("revenueShare"), brokerNet: sum("brokerNet") },
  };
}

export interface StatementLine {
  date: string;
  entryId: string;
  type: string;
  description: string;
  reference: string | null;
  policyId: string | null;
  /** Money received by / due to the insurer. */
  credit: number;
  /** Money the insurer pays out (commission, platform fee) or refunds. */
  debit: number;
  balance: number;
}
export interface InsurerStatement {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  lines: StatementLine[];
  totals: { premiums: number; refunds: number; commissionPayable: number; platformFeesPayable: number; adjustments: number; netRetained: number };
}

/**
 * The insurer's statement for a period from its ledger entries: premiums received directly from
 * customers (Covva never held them), refunds, and the broker commission and platform fees payable
 * out of those premiums. `netRetained` = premiums − refunds − commission − fees (± adjustments).
 */
export function insurerStatement(entries: readonly LedgerEntryLike[], statement: { orgId: string; periodStart: string; periodEnd: string; currency?: string }): InsurerStatement {
  const org = statement.orgId;
  const sorted = entries
    .filter((e) => (e.org_id === org || e.counterparty_org_id === org) && e.created_at.slice(0, 10) >= statement.periodStart && e.created_at.slice(0, 10) <= statement.periodEnd)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  let balance = 0;
  const t = { premiums: 0, refunds: 0, commission: 0, fees: 0, adjustments: 0 };
  const lines: StatementLine[] = [];
  for (const e of sorted) {
    const minor = toMinor(Number(e.amount));
    // Signed from the insurer's point of view: credits to the insurer +, debits (it pays) −.
    const signed = e.org_id === org ? minor : -minor;
    if (e.entry_type === "premium_received" || e.entry_type === "premium_to_insurer") t.premiums += signed;
    else if (e.entry_type === "refund") t.refunds += signed;
    else if (e.entry_type === "broker_commission" || isCommissionReversal(e)) t.commission += signed;
    else if (e.entry_type === "platform_fee" || isFeeReversal(e)) t.fees += signed;
    else t.adjustments += signed;
    balance += signed;
    lines.push({
      date: e.created_at.slice(0, 10),
      entryId: String(e.id),
      type: LEDGER_ENTRY_LABEL[e.entry_type] ?? e.entry_type,
      description: e.memo ?? LEDGER_ENTRY_LABEL[e.entry_type] ?? e.entry_type,
      reference: e.reference ?? null,
      policyId: e.policy_id ?? null,
      credit: signed > 0 ? fromMinor(signed) : 0,
      debit: signed < 0 ? fromMinor(-signed) : 0,
      balance: fromMinor(balance),
    });
  }
  return {
    orgId: org,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    currency: statement.currency ?? sorted[0]?.currency ?? "GHS",
    lines,
    totals: {
      premiums: fromMinor(t.premiums),
      refunds: fromMinor(-t.refunds),
      commissionPayable: fromMinor(-t.commission),
      platformFeesPayable: fromMinor(-t.fees),
      adjustments: fromMinor(t.adjustments),
      netRetained: fromMinor(balance),
    },
  };
}

// ---------------------------------------------------------------------------
// Journal lines and accounting-software CSVs
// ---------------------------------------------------------------------------
/** One side of a double-entry journal line. Amounts are positive; exactly one of debit / credit is set. */
export interface JournalRow {
  /** YYYY-MM-DD */
  date: string;
  /** Groups the lines of one journal (the ledger entry id, prefixed). */
  journal: string;
  reference: string | null;
  description: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  currency: string;
  /** Counterparty name (Xero tracking / QuickBooks "Name" / Sage account reference). */
  contact?: string | null;
  /** Tax code in the target system; defaults to "no VAT". */
  taxCode?: string | null;
  taxAmount?: number;
}

/**
 * Default chart of accounts used when the organisation has not mapped its own codes. Change the
 * codes after import if your chart differs. "Receivable" / "Payable" accounts hold amounts settled
 * through Covva statements; premiums are booked to the insurer's bank (customers paid it directly).
 */
export const DEFAULT_ACCOUNTS = {
  bank: { code: "1000", name: "Bank (premiums received directly)" },
  receivable: { code: "1200", name: "Accounts receivable — Covva settlements" },
  payable: { code: "2100", name: "Accounts payable — Covva settlements" },
  taxPayable: { code: "2200", name: "VAT / levies payable" },
  premiumIncome: { code: "4000", name: "Gross written premium" },
  commissionIncome: { code: "4100", name: "Commission income" },
  feeIncome: { code: "4200", name: "Platform fee income" },
  revenueShareIncome: { code: "4210", name: "Revenue share income" },
  subscriptionIncome: { code: "4300", name: "Subscription income" },
  commissionExpense: { code: "5100", name: "Commission expense" },
  feeExpense: { code: "5200", name: "Platform fees" },
  revenueShareExpense: { code: "5210", name: "Revenue share to Covva" },
  refunds: { code: "4050", name: "Premium refunds" },
  adjustments: { code: "4900", name: "Settlement adjustments" },
} as const;
type AccountKey = keyof typeof DEFAULT_ACCOUNTS;

/**
 * Turns ledger entries into balanced journal rows from `orgId`'s point of view (two rows per entry).
 * Credits to the org are income (Dr receivable/bank, Cr income); entries where it is the
 * counterparty are expenses (Dr expense, Cr payable). Negative amounts swap sides.
 */
export function ledgerToJournal(entries: readonly LedgerEntryLike[], orgId: string, opts: { names?: Record<string, string>; accounts?: Partial<Record<AccountKey, { code: string; name: string }>> } = {}): JournalRow[] {
  const acc = { ...DEFAULT_ACCOUNTS, ...(opts.accounts ?? {}) } as Record<AccountKey, { code: string; name: string }>;
  const out: JournalRow[] = [];
  for (const e of entries) {
    const mine = e.org_id === orgId;
    const theirs = e.counterparty_org_id === orgId;
    if (!mine && !theirs) continue;
    const amountMinor = toMinor(Number(e.amount));
    if (amountMinor === 0) continue;
    let dr: AccountKey;
    let cr: AccountKey;
    if (mine) {
      cr =
        e.entry_type === "premium_received" || e.entry_type === "premium_to_insurer" ? "premiumIncome"
        : e.entry_type === "refund" ? "refunds"
        : e.entry_type === "broker_commission" ? "commissionIncome"
        : e.entry_type === "platform_fee" ? "feeIncome"
        : e.entry_type === "revenue_share" ? "revenueShareIncome"
        : e.entry_type === "subscription_fee" ? "subscriptionIncome"
        : "adjustments";
      dr = e.entry_type === "premium_received" || e.entry_type === "premium_to_insurer" || e.entry_type === "refund" ? "bank" : "receivable";
    } else {
      dr =
        e.entry_type === "broker_commission" ? "commissionExpense"
        : e.entry_type === "platform_fee" ? "feeExpense"
        : e.entry_type === "revenue_share" ? "revenueShareExpense"
        : "adjustments";
      cr = "payable";
    }
    if (amountMinor < 0) [dr, cr] = [cr, dr];
    const amount = fromMinor(Math.abs(amountMinor));
    const other = mine ? e.counterparty_org_id : e.org_id;
    const contact = other ? opts.names?.[other] ?? other : mine ? "Customer" : null;
    const base = { date: e.created_at.slice(0, 10), journal: `COVVA-${e.id}`, reference: e.reference ?? null, description: e.memo ?? LEDGER_ENTRY_LABEL[e.entry_type] ?? e.entry_type, currency: e.currency, contact };
    out.push({ ...base, accountCode: acc[dr].code, accountName: acc[dr].name, debit: amount, credit: 0 });
    out.push({ ...base, accountCode: acc[cr].code, accountName: acc[cr].name, debit: 0, credit: amount });
  }
  return out;
}

/** RFC 4180 CSV with CRLF line endings; cells starting with = + - @ are prefixed with ' (formula injection). */
export function csvString(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const money2 = (n: number) => n.toFixed(2);

/**
 * Xero — Manual Journal import (Accounting → Manual journals → Import).
 *   *Narration       ← journal (one narration per balanced journal) + description
 *   *Date            ← date (DD/MM/YYYY)
 *   Description      ← description
 *   *AccountCode     ← accountCode
 *   *TaxRate         ← taxCode, default "No VAT" (rename to your organisation's tax rate name)
 *   *Amount          ← debit as positive, credit as negative
 *   TrackingName1 / TrackingOption1 ← "Counterparty" / contact
 */
export function toXeroCsv(rows: readonly JournalRow[]): string {
  return csvString(
    ["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount", "TrackingName1", "TrackingOption1"],
    rows.map((r) => [`${r.journal}${r.reference ? ` ${r.reference}` : ""}`, dmy(r.date), r.description, r.accountCode, r.taxCode ?? "No VAT", money2(r.debit > 0 ? r.debit : -r.credit), r.contact ? "Counterparty" : "", r.contact ?? ""]),
  );
}

/**
 * QuickBooks Online — Journal entry import (Settings → Import data → Journal entries).
 *   Journal No.      ← journal
 *   Journal Date     ← date (DD/MM/YYYY; match the company's date format)
 *   Account Name     ← "<accountCode> <accountName>" (must exist in the chart of accounts)
 *   Debits / Credits ← debit / credit
 *   Description      ← description (+ reference)
 *   Name             ← contact
 *   Currency Code    ← currency
 */
export function toQuickBooksCsv(rows: readonly JournalRow[]): string {
  return csvString(
    ["Journal No.", "Journal Date", "Account Name", "Debits", "Credits", "Description", "Name", "Currency Code"],
    rows.map((r) => [r.journal, dmy(r.date), `${r.accountCode} ${r.accountName}`, r.debit ? money2(r.debit) : "", r.credit ? money2(r.credit) : "", r.reference ? `${r.description} (${r.reference})` : r.description, r.contact ?? "", r.currency]),
  );
}

/**
 * Sage 50 Accounts — Audit trail transactions import (File → Import → Audit trail transactions).
 *   Type             ← JD (journal debit) / JC (journal credit)
 *   Account Reference← blank (nominal journals)
 *   Nominal A/C Ref  ← accountCode
 *   Department Code  ← 0
 *   Date             ← date (DD/MM/YYYY)
 *   Reference        ← journal
 *   Details          ← description (+ reference)
 *   Net Amount       ← debit or credit (positive)
 *   Tax Code         ← taxCode, default T9 (non-VAT transactions)
 *   Tax Amount       ← taxAmount (default 0.00)
 */
export function toSageCsv(rows: readonly JournalRow[]): string {
  return csvString(
    ["Type", "Account Reference", "Nominal A/C Ref", "Department Code", "Date", "Reference", "Details", "Net Amount", "Tax Code", "Tax Amount"],
    rows.map((r) => [r.debit > 0 ? "JD" : "JC", "", r.accountCode, "0", dmy(r.date), r.journal, (r.reference ? `${r.description} (${r.reference})` : r.description).slice(0, 60), money2(r.debit > 0 ? r.debit : r.credit), r.taxCode ?? "T9", money2(r.taxAmount ?? 0)]),
  );
}

/** Balanced check for journal rows (sum of debits = sum of credits, to the pesewa). */
export function journalBalanced(rows: readonly JournalRow[]): boolean {
  return rows.reduce((s, r) => s + toMinor(r.debit) - toMinor(r.credit), 0) === 0;
}

export const ACCOUNTING_EXPORT_KINDS = ["insurer_statement", "commission_report", "tax_report", "platform_revenue", "xero_csv", "quickbooks_csv", "sage_csv"] as const;
export type AccountingExportKind = (typeof ACCOUNTING_EXPORT_KINDS)[number];
export const ACCOUNTING_EXPORT_LABEL: Record<AccountingExportKind, string> = {
  insurer_statement: "Insurer statement",
  commission_report: "Commission report",
  tax_report: "Tax report (VAT / levies)",
  platform_revenue: "Platform revenue",
  xero_csv: "Xero manual journals (CSV)",
  quickbooks_csv: "QuickBooks journal entries (CSV)",
  sage_csv: "Sage 50 audit trail (CSV)",
};

/** Calendar month as inclusive ISO dates, from "YYYY-MM". */
export function monthPeriod(month: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return { start, end };
}
