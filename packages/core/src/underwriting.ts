/**
 * Underwriting rules (Addendum 3 B3): accept / refer / decline decisions from a simple
 * JSON rule tree evaluated against the risk data. "refer" sends the risk to the insurer's
 * L1 review; "decline" blocks the product for that risk; a risk only fits delegated
 * (instant / within-hours) issuance when every active rule accepts it.
 */
import type { RiskData } from "./rating";

export type RuleOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "missing";
export const RULE_OPS: { value: RuleOp; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "in", label: "is one of" },
  { value: "not_in", label: "is not one of" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "is provided" },
  { value: "missing", label: "is missing" },
];

export type RuleCondition =
  | { field: string; op: RuleOp; value?: unknown }
  | { and: RuleCondition[] }
  | { or: RuleCondition[] }
  | { not: RuleCondition };

export type RuleOutcome = "accept" | "refer" | "decline";
export const RULE_OUTCOMES: RuleOutcome[] = ["accept", "refer", "decline"];

export interface UnderwritingRule {
  id?: string;
  name: string;
  condition: RuleCondition;
  outcome: RuleOutcome;
  message?: string | null;
  priority?: number | null;
  active?: boolean | null;
}

export interface MatchedRule { id?: string; name: string; outcome: RuleOutcome; message: string | null; priority: number }
export interface UnderwritingResult {
  outcome: RuleOutcome;
  matched: MatchedRule[];
  /** Messages of the rules that decided the outcome (decline > refer), for the broker/insurer. */
  reasons: string[];
}

export type IssuanceType = "instant" | "within_hours" | "manual";
export const ISSUANCE_TYPES: IssuanceType[] = ["instant", "within_hours", "manual"];

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
};
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => {
  if (a === b) return true;
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,|]/).map((s) => s.trim()).filter(Boolean) : v === undefined || v === null ? [] : [v]);

/** Reads `a.b.c` paths from the risk data. */
function read(risk: RiskData, field: string): unknown {
  if (field in risk) return risk[field];
  return field.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), risk);
}

export function evaluateCondition(cond: RuleCondition | null | undefined, risk: RiskData): boolean {
  if (!cond || typeof cond !== "object") return false;
  if ("and" in cond) return Array.isArray(cond.and) && cond.and.length > 0 && cond.and.every((c) => evaluateCondition(c, risk));
  if ("or" in cond) return Array.isArray(cond.or) && cond.or.some((c) => evaluateCondition(c, risk));
  if ("not" in cond) return !evaluateCondition(cond.not, risk);
  if (!("field" in cond) || !cond.field) return false;
  const actual = read(risk, cond.field);
  const expected = cond.value;
  switch (cond.op) {
    case "exists": return !empty(actual);
    case "missing": return empty(actual);
    case "eq": return same(actual, expected);
    case "neq": return !same(actual, expected);
    case "gt": case "gte": case "lt": case "lte": {
      const a = num(actual);
      const b = num(expected);
      if (a === null || b === null) return false;
      return cond.op === "gt" ? a > b : cond.op === "gte" ? a >= b : cond.op === "lt" ? a < b : a <= b;
    }
    case "in": return list(expected).some((x) => same(actual, x));
    case "not_in": return !empty(actual) && !list(expected).some((x) => same(actual, x));
    case "contains": {
      if (Array.isArray(actual)) return actual.some((x) => same(x, expected));
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    }
    default: return false;
  }
}

const RANK: Record<RuleOutcome, number> = { accept: 0, refer: 1, decline: 2 };

/**
 * Evaluates every active rule (priority ascending). The worst matched outcome wins:
 * decline > refer > accept. With no matching rule the risk is accepted.
 */
export function evaluateRules(rules: UnderwritingRule[], risk: RiskData): UnderwritingResult {
  const active = rules.filter((r) => r.active !== false).map((r, i) => ({ r, i })).sort((a, b) => (a.r.priority ?? 100) - (b.r.priority ?? 100) || a.i - b.i);
  const matched: MatchedRule[] = [];
  for (const { r } of active) {
    if (evaluateCondition(r.condition, risk)) {
      matched.push({ id: r.id, name: r.name, outcome: r.outcome, message: r.message ?? null, priority: r.priority ?? 100 });
    }
  }
  const outcome = matched.reduce<RuleOutcome>((worst, m) => (RANK[m.outcome] > RANK[worst] ? m.outcome : worst), "accept");
  const reasons = matched.filter((m) => m.outcome === outcome && outcome !== "accept").map((m) => m.message ?? m.name);
  return { outcome, matched, reasons };
}

/**
 * Delegated issuance (L2 instant / within-hours) is only allowed when the product
 * version is set up for it AND no rule refers or declines the risk.
 */
export function fitsDelegatedIssuance(rules: UnderwritingRule[], risk: RiskData, productIssuanceType: IssuanceType | string | null | undefined): { fits: boolean; outcome: RuleOutcome; reason: string } {
  const result = evaluateRules(rules, risk);
  if (productIssuanceType !== "instant" && productIssuanceType !== "within_hours") {
    return { fits: false, outcome: result.outcome, reason: "This product is issued manually by the insurer or broker." };
  }
  if (result.outcome === "accept") return { fits: true, outcome: "accept", reason: "All underwriting rules accept this risk." };
  return {
    fits: false,
    outcome: result.outcome,
    reason: result.outcome === "decline" ? `Declined: ${result.reasons.join("; ")}` : `Referred to the insurer for review: ${result.reasons.join("; ")}`,
  };
}

/** Customer-facing issuance label (Addendum 2 G: shown before payment). */
export function issuanceLabel(issuanceType: IssuanceType | string | null | undefined, slaHours?: number | null): string {
  if (issuanceType === "instant") return "Instant";
  if (issuanceType === "within_hours") {
    const h = slaHours && slaHours > 0 ? slaHours : 24;
    return h % 24 === 0 && h > 24 ? `Issued within ${h / 24} days` : `Issued within ${h} hour${h === 1 ? "" : "s"}`;
  }
  return slaHours && slaHours > 0 ? `Issued by the insurer within ${slaHours} hours` : "Issued by the insurer after review";
}
