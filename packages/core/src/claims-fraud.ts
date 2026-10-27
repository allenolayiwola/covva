/**
 * Claim fraud indicators (Roadmap Phase 2). The database raises flags
 * (private.run_claim_fraud_checks in supabase/migrations/20261029100200_claims_completion.sql);
 * this module is the pure, shared scoring so the web, admin and mobile apps read them the same way.
 * Flags are for the insurer's claims team and platform staff only — never shown to customers.
 */
export type FraudKind = "duplicate_claim" | "identity_mismatch" | "policy_inactive_at_incident" | "late_report" | "repeat_claimant" | "document_reuse";
export type FraudFlagStatus = "open" | "cleared" | "confirmed";
export type FraudStatus = "clear" | "review" | "confirmed";

export interface FraudFlagLike {
  kind: FraudKind | string;
  status?: FraudFlagStatus | string | null;
  /** Optional stored score; when absent the kind's default weight applies. */
  score?: number | string | null;
}

/** Weights must match private.fraud_flag_weight() in the database. */
export const FRAUD_KIND_WEIGHTS: Record<FraudKind, number> = {
  duplicate_claim: 40,
  document_reuse: 35,
  identity_mismatch: 30,
  policy_inactive_at_incident: 30,
  late_report: 15,
  repeat_claimant: 15,
};

export const FRAUD_KIND_LABELS: Record<FraudKind, { label: string; hint: string }> = {
  duplicate_claim: { label: "Possible duplicate claim", hint: "Another claim on the same policy has an incident date within 7 days." },
  identity_mismatch: { label: "Identity mismatch", hint: "The claimant's profile name or Ghana Card differs from the insured named on the policy." },
  policy_inactive_at_incident: { label: "Policy not active on the incident date", hint: "The incident falls outside the cover period or after cancellation." },
  late_report: { label: "Late report", hint: "Reported well after the incident (threshold set in platform settings)." },
  repeat_claimant: { label: "Repeat claimant", hint: "Three or more claims by this customer in the last 12 months." },
  document_reuse: { label: "Document reused", hint: "A file with the same checksum was uploaded on another claim." },
};

export const FRAUD_STATUS_LABELS: Record<FraudStatus, { label: string; tone: "ok" | "wait" | "danger" }> = {
  clear: { label: "No flags", tone: "ok" },
  review: { label: "Needs review", tone: "wait" },
  confirmed: { label: "Fraud confirmed", tone: "danger" },
};

/** Score at or above which a claim goes to "review". */
export const FRAUD_REVIEW_THRESHOLD = 40;

export function fraudKindWeight(kind: string): number {
  return (FRAUD_KIND_WEIGHTS as Record<string, number>)[kind] ?? 10;
}

/**
 * Sum the open/confirmed flags (cleared ones no longer count), cap at 100 and derive the status:
 * any confirmed flag → `confirmed`; score ≥ 40 → `review`; otherwise `clear`.
 * Mirrors private.refresh_claim_fraud_summary() so the UI can preview the effect of clearing a flag.
 */
export function scoreFraudFlags(flags: readonly FraudFlagLike[]): { score: number; status: FraudStatus; open: number } {
  let score = 0;
  let confirmed = false;
  let open = 0;
  for (const f of flags) {
    const status = f.status ?? "open";
    if (status === "cleared") continue;
    if (status === "confirmed") confirmed = true;
    else open++;
    const stored = f.score == null || f.score === "" ? NaN : Number(f.score);
    score += Number.isFinite(stored) && stored > 0 ? stored : fraudKindWeight(f.kind);
  }
  score = Math.min(100, Math.round(score * 100) / 100);
  return { score, status: confirmed ? "confirmed" : score >= FRAUD_REVIEW_THRESHOLD ? "review" : "clear", open };
}

/** Who may see fraud flags: the claim's insurer team and platform staff. Brokers and customers never. */
export function canSeeFraudFlags(party: "customer" | "broker" | "insurer" | "platform" | "system" | "ai" | string): boolean {
  return party === "insurer" || party === "platform";
}
