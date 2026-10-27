import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTaxRules,
  commissionReport,
  csvString,
  insurerStatement,
  journalBalanced,
  ledgerToJournal,
  monthPeriod,
  taxBaseForEntry,
  toQuickBooksCsv,
  toSageCsv,
  toXeroCsv,
  type LedgerEntryLike,
  type TaxRuleLike,
} from "./accounting.ts";

const rule = (o: Partial<TaxRuleLike> & { code: string }): TaxRuleLike => ({ applies_to: "platform_fee", rate: null, inclusive: false, effective_from: "2026-01-01", effective_to: null, status: "needs_confirmation", ...o });

test("applyTaxRules skips rules that need confirmation, are retired, have no rate or are out of force", () => {
  const rules = [
    rule({ code: "VAT" }),
    rule({ code: "NHIL", status: "retired", rate: 2.5 }),
    rule({ code: "GETFUND", status: "active", rate: null }),
    rule({ code: "OLD", status: "active", rate: 1, effective_to: "2025-12-31" }),
  ];
  const r = applyTaxRules(100, rules, "2026-10-27");
  assert.deepEqual(r.lines, []);
  assert.equal(r.tax, 0);
  assert.equal(r.gross, 100);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["needs_confirmation", "retired", "no_rate", "not_in_force"]);
});

test("applyTaxRules: active exclusive and inclusive rules, pesewa rounding, base filter", () => {
  const rules = [rule({ code: "A", status: "active", rate: 15 }), rule({ code: "B", status: "active", rate: 2.5 }), rule({ code: "C", status: "active", rate: 5, applies_to: "premium" })];
  const r = applyTaxRules(333.33, rules, new Date("2026-06-01T10:00:00Z"), { appliesTo: "platform_fee" });
  assert.deepEqual(r.lines.map((l) => [l.code, l.amount]), [["A", 50], ["B", 8.33]]);
  assert.equal(r.tax, 58.33);
  assert.equal(r.gross, 391.66);
  assert.equal(r.net, 333.33);
  assert.deepEqual(r.skipped, [{ code: "C", reason: "other_base" }]);
  const inc = applyTaxRules(115, [rule({ code: "VAT", status: "active", rate: 15, inclusive: true })], "2026-06-01");
  assert.equal(inc.tax, 15);
  assert.equal(inc.net, 100);
  assert.equal(inc.gross, 115);
  // Not yet in force.
  assert.equal(applyTaxRules(100, [rule({ code: "F", status: "active", rate: 10, effective_from: "2027-01-01" })], "2026-06-01").tax, 0);
});

test("taxBaseForEntry", () => {
  assert.equal(taxBaseForEntry("platform_fee"), "platform_fee");
  assert.equal(taxBaseForEntry("revenue_share"), "platform_fee");
  assert.equal(taxBaseForEntry("broker_commission"), "broker_commission");
  assert.equal(taxBaseForEntry("refund"), null);
});

const INS = "ins-1";
const BRK = "brk-1";
const PLT = "plt-1";
const e = (id: number, entry_type: string, org_id: string, counterparty_org_id: string | null, amount: number, extra: Partial<LedgerEntryLike> = {}): LedgerEntryLike => ({
  id,
  created_at: `2026-09-${String(10 + id).padStart(2, "0")}T09:00:00Z`,
  entry_type,
  org_id,
  counterparty_org_id,
  amount,
  currency: "GHS",
  memo: null,
  reference: `PSK-${id}`,
  payment_id: `pay-${id}`,
  policy_id: `pol-${id % 2}`,
  ...extra,
});
const LEDGER: LedgerEntryLike[] = [
  e(1, "premium_received", INS, null, 1000),
  e(2, "broker_commission", BRK, INS, 125.5),
  e(3, "platform_fee", PLT, INS, 30),
  e(4, "revenue_share", PLT, BRK, 25.1),
  e(5, "refund", INS, null, -1000),
  e(6, "adjustment", BRK, INS, -125.5, { memo: "Reversal of broker commission (refund)" }),
  e(7, "adjustment", PLT, INS, -30, { memo: "Reversal of platform fee (refund)" }),
  e(8, "premium_received", INS, null, 2000),
  e(9, "broker_commission", BRK, INS, 250),
];

test("commissionReport groups by broker and insurer with reversals and revenue share", () => {
  const r = commissionReport(LEDGER);
  const main = r.rows.find((x) => x.brokerOrgId === BRK && x.insurerOrgId === INS)!;
  assert.equal(main.grossCommission, 375.5);
  assert.equal(main.reversals, -125.5);
  assert.equal(main.netCommission, 250);
  assert.equal(main.entries, 3);
  const share = r.rows.find((x) => x.brokerOrgId === BRK && x.insurerOrgId === null)!;
  assert.equal(share.revenueShare, 25.1);
  assert.equal(r.totals.netCommission, 250);
  assert.equal(r.totals.brokerNet, 224.9);
  assert.equal(commissionReport(LEDGER, { insurerOrgId: INS }).rows.length, 1);
});

test("insurerStatement: premiums, refunds, commission and fees payable, running balance", () => {
  const s = insurerStatement(LEDGER, { orgId: INS, periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  assert.equal(s.totals.premiums, 3000);
  assert.equal(s.totals.refunds, 1000);
  assert.equal(s.totals.commissionPayable, 250);
  assert.equal(s.totals.platformFeesPayable, 0);
  assert.equal(s.totals.netRetained, 1750);
  assert.equal(s.lines.length, 8); // the revenue share (platform ← broker) is not the insurer's
  assert.equal(s.lines.at(-1)!.balance, 1750);
  assert.equal(s.lines[1]!.debit, 125.5);
  assert.equal(insurerStatement(LEDGER, { orgId: INS, periodStart: "2026-10-01", periodEnd: "2026-10-31" }).lines.length, 0);
});

test("ledgerToJournal is balanced and maps income / expense accounts", () => {
  const brokerRows = ledgerToJournal(LEDGER, BRK, { names: { [INS]: "Coastline General" } });
  assert.ok(journalBalanced(brokerRows));
  const comm = brokerRows.filter((r) => r.journal === "COVVA-2");
  assert.deepEqual(comm.map((r) => [r.accountCode, r.debit, r.credit]), [["1200", 125.5, 0], ["4100", 0, 125.5]]);
  assert.equal(comm[0]!.contact, "Coastline General");
  // Reversal swaps sides; revenue share is an expense for the broker.
  assert.deepEqual(brokerRows.filter((r) => r.journal === "COVVA-6").map((r) => [r.accountCode, r.debit, r.credit]), [["4100", 125.5, 0], ["1200", 0, 125.5]]);
  assert.deepEqual(brokerRows.filter((r) => r.journal === "COVVA-4").map((r) => r.accountCode), ["5210", "2100"]);
  assert.ok(journalBalanced(ledgerToJournal(LEDGER, INS)));
  assert.ok(journalBalanced(ledgerToJournal(LEDGER, PLT)));
});

test("CSV formats: Xero, QuickBooks and Sage headers, dates and signs", () => {
  const rows = ledgerToJournal([e(2, "broker_commission", BRK, INS, 125.5, { memo: "Commission, 12%" })], BRK, { names: { [INS]: "Coastline" } });
  const xero = toXeroCsv(rows).split("\r\n");
  assert.equal(xero[0], "*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount,TrackingName1,TrackingOption1");
  assert.equal(xero[1], 'COVVA-2 PSK-2,12/09/2026,"Commission, 12%",1200,No VAT,125.50,Counterparty,Coastline');
  assert.equal(xero[2], 'COVVA-2 PSK-2,12/09/2026,"Commission, 12%",4100,No VAT,-125.50,Counterparty,Coastline');
  const qb = toQuickBooksCsv(rows).split("\r\n");
  assert.equal(qb[0], "Journal No.,Journal Date,Account Name,Debits,Credits,Description,Name,Currency Code");
  assert.equal(qb[1], 'COVVA-2,12/09/2026,1200 Accounts receivable — Covva settlements,125.50,,"Commission, 12% (PSK-2)",Coastline,GHS');
  assert.equal(qb[2], 'COVVA-2,12/09/2026,4100 Commission income,,125.50,"Commission, 12% (PSK-2)",Coastline,GHS');
  const sage = toSageCsv(rows).split("\r\n");
  assert.equal(sage[0], "Type,Account Reference,Nominal A/C Ref,Department Code,Date,Reference,Details,Net Amount,Tax Code,Tax Amount");
  assert.equal(sage[1], 'JD,,1200,0,12/09/2026,COVVA-2,"Commission, 12% (PSK-2)",125.50,T9,0.00');
  assert.equal(sage[2], 'JC,,4100,0,12/09/2026,COVVA-2,"Commission, 12% (PSK-2)",125.50,T9,0.00');
  assert.equal(sage[3], "");
});

test("csvString escapes quotes and neutralises formulas", () => {
  assert.equal(csvString(["a", "b"], [['say "hi"', "=SUM(A1)"], [null, 3]]), 'a,b\r\n"say ""hi""",\'=SUM(A1)\r\n,3\r\n');
});

test("monthPeriod", () => {
  assert.deepEqual(monthPeriod("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(monthPeriod("2026-13"), null);
});

test("buildExportCsv: tax report lists unconfirmed rules as not applied and taxes the earner's fees for active rules", async () => {
  const { buildExportCsv, exportStoragePath, periodLabel } = await import("./accounting.ts");
  const period = { start: "2026-09-01", end: "2026-09-30" };
  const pending = buildExportCsv("tax_report", { entries: LEDGER, orgId: null, platformOrgId: PLT, taxRules: [rule({ code: "VAT" })], period });
  assert.equal(pending.rows, 0);
  assert.equal(pending.taxLines.length, 0);
  assert.match(pending.csv, /Not applied,,,VAT,,,,,Rate needs confirmation/);
  const active = buildExportCsv("tax_report", { entries: LEDGER, orgId: null, platformOrgId: PLT, taxRules: [rule({ id: "r1", code: "VAT", status: "active", rate: 10 })], period });
  // Covva's own fees only: platform_fee 30 → 3.00, revenue_share 25.10 → 2.51 (adjustments are not a tax base).
  assert.deepEqual(active.taxLines.map((t) => [t.ledgerEntryId, t.code, t.amount]), [[3, "VAT", 3], [4, "VAT", 2.51]]);
  assert.equal(active.rows, 2);
  const statement = buildExportCsv("insurer_statement", { entries: LEDGER, orgId: INS, orgType: "insurer", platformOrgId: PLT, names: { [INS]: "Coastline" }, period });
  assert.equal(statement.rows, 8);
  assert.match(statement.csv, /Net retained,Coastline · 2026-09-01 to 2026-09-30,,,,,1750.00,GHS/);
  assert.equal(periodLabel(period), "2026-09");
  assert.equal(periodLabel({ start: "2026-09-01", end: "2026-09-15" }), "2026-09-01_2026-09-15");
  assert.equal(exportStoragePath("xero_csv", null, period), "exports/platform/xero_csv-2026-09.csv");
});
