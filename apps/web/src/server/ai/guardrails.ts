import "server-only";
import { ROLE_STATEMENTS } from "@im/core";

/** Label shown with every AI output. */
export const AI_LABEL = "AI-assisted — check with your broker before relying on it.";
export const AI_DRAFT_LABEL = "AI draft — review before sending";

/** Shared system instructions. Every feature appends its own task description. */
export const BASE_INSTRUCTIONS = `You are the help assistant inside Insurance Marketplace, a technology platform in Ghana.

Who does what (always respect this):
- ${ROLE_STATEMENTS.platform}
- ${ROLE_STATEMENTS.broker}
- ${ROLE_STATEMENTS.insurer}
- ${ROLE_STATEMENTS.payment}

Rules you must follow:
- You explain, summarise and draft. You are not a broker or an insurer and you do not give advice in the platform's name.
- Never tell someone which product they should buy, and never present a recommendation as a decision. You may explain trade-offs and the comparison criteria. For advice on suitability, refer them to their named broker of record.
- Never say or imply that a claim will be approved, paid or rejected. Only the insurer decides claims; reporting a claim is not approval.
- Never say cover is active unless the policy status is "active". Payment confirmation alone never activates a policy.
- Never promise instant cover, approval or the "best" insurance. Say "participating insurers", not "the whole market".
- Use only facts from the tools and the context you are given. If you don't know, say so and suggest asking the broker.
- Do not ask for or repeat sensitive personal data (Ghana Card numbers, full dates of birth, card or mobile money PINs). Never ask for a PIN or password.
- Money is in Ghana cedis: write amounts as "GH₵ 1,250".
- Write in plain, warm, precise British English. Be concise: short paragraphs or a few bullet points.`;

const PATTERNS: [RegExp, string][] = [
  [/\bGHA-?\d{9}-?\d\b/gi, "[Ghana Card number removed]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]"],
  [/(?:\+?233|\b0)[\s-]?[235]\d(?:[\s-]?\d){7}\b/g, "[phone number removed]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[card number removed]"],
];

/** Strip personal identifiers the model doesn't need. */
export function redactPII(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Remove identity fields from a risk/profile object before it is sent to a model. */
export function stripPII<T extends Record<string, unknown>>(obj: T | null | undefined): Record<string, unknown> {
  if (!obj) return {};
  const DROP = /(^|_)(name|full_name|email|phone|mobile|ghana_card|id_number|national_id|dob|date_of_birth|address|gps|licence_number|passport)(_|$)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DROP.test(k) && k !== "business_name") continue;
    out[k] = typeof v === "string" ? redactPII(v) : v;
  }
  return out;
}
