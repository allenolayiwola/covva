"use client";
import { useMemo, useState } from "react";
import { Card, Notice, Pill } from "@im/ui";
import { evaluateRules, fitsDelegatedIssuance, formatGHS, issuanceLabel, ratePremium, type RateRow, type RatingRule, type RiskField, type UnderwritingRule } from "@im/core";
import { RiskFields } from "./risk-fields";

/**
 * Quote simulator for insurers: enter a risk, see the premium (rating lines), the
 * underwriting outcome and whether the risk fits delegated issuance. Uses exactly the
 * core functions live quoting uses; rate-table rows are injected by the server page.
 */
export function QuoteSimulator({ fields, rating, rows, rules, issuanceType, slaHours, tableStatus }: { fields: RiskField[]; rating: RatingRule | null; rows: RateRow[] | null; rules: UnderwritingRule[]; issuanceType: string; slaHours: number | null; tableStatus?: string | null }) {
  const [risk, setRisk] = useState<Record<string, unknown>>({});
  const onChange = (key: string, value: string) => {
    const f = fields.find((x) => x.key === key);
    const v = f?.type === "number" || f?.type === "currency" ? (value === "" ? "" : Number(value)) : f?.type === "boolean" ? value === "true" : value;
    setRisk((r) => ({ ...r, [key]: v }));
  };
  const result = useMemo(() => {
    if (!rating || !("model" in rating)) return { error: "This version has no rating rule yet." };
    try {
      const rule = rating.model === "rate_table" ? { ...rating, rows: rows ?? undefined } : rating;
      return { premium: ratePremium(rule, risk), underwriting: evaluateRules(rules, risk), delegated: fitsDelegatedIssuance(rules, risk, issuanceType) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [rating, rows, rules, risk, issuanceType]);

  const tone = (o: string) => (o === "accept" ? "ok" : o === "refer" ? "wait" : "danger") as "ok" | "wait" | "danger";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <p className="mb-3 text-sm text-muted">Enter a sample risk. Nothing is saved; this is the insurer-side preview of what a customer would be shown.</p>
        <RiskFields fields={fields} requiredOff idPrefix="sim" onChange={onChange} />
      </div>
      <div className="space-y-4">
        {"error" in result ? (
          <Notice tone="danger">{result.error}</Notice>
        ) : (
          <>
            <Card className="p-5">
              <p className="text-sm text-muted">Indicative premium</p>
              <p className="mt-1 text-[32px] font-bold leading-none tracking-tight text-ink">{result.premium.ok ? formatGHS(result.premium.premium) : "—"}</p>
              {!result.premium.ok && <p className="mt-2 text-xs text-danger">Missing: {result.premium.missingFields.map((m) => m.replace(/_/g, " ")).join(", ")}</p>}
              {rating?.model === "rate_table" && tableStatus && tableStatus !== "approved" && <p className="mt-2 text-xs text-muted">Rate table is {tableStatus.replace("_", " ")} — live quotes only use approved tables.</p>}
              <ul className="mt-3 space-y-1 text-sm text-ink-2">
                {result.premium.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span className="font-medium">{l.amount !== undefined ? formatGHS(l.amount) : l.factor !== undefined ? `× ${l.factor}` : ""}</span></li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Underwriting</p>
                <Pill tone={tone(result.underwriting.outcome)}>{result.underwriting.outcome === "refer" ? "Refer to insurer" : result.underwriting.outcome}</Pill>
              </div>
              {result.underwriting.matched.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {result.underwriting.matched.map((m) => (
                    <li key={m.id ?? m.name} className="flex items-start gap-2"><Pill tone={tone(m.outcome)}>{m.outcome}</Pill><span className="text-ink-2">{m.name}{m.message ? ` — ${m.message}` : ""}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">No rule matched ({rules.length} active rule{rules.length === 1 ? "" : "s"}); the risk is accepted.</p>
              )}
            </Card>
            <Card className="p-5">
              <p className="text-sm font-semibold text-ink">Issuance</p>
              <p className="mt-1 text-sm text-ink-2">Customers see: <span className="font-medium text-ink">{issuanceLabel(issuanceType, slaHours)}</span></p>
              <p className={result.delegated.fits ? "mt-1 text-sm text-brand-deep" : "mt-1 text-sm text-muted"}>{result.delegated.fits ? "Fits delegated issuance rules." : result.delegated.reason}</p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
