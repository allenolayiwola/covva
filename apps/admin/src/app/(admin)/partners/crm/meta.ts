/** Client-safe labels and tones for the partnerships CRM pages. */
import { CRM_ACCOUNT_KIND_LABEL, CRM_SOURCE_LABEL, CRM_STAGES, type CrmStage } from "@im/core";

export type Tone = "neutral" | "ok" | "wait" | "danger" | "info";

export const STAGE_TONE: Record<CrmStage, Tone> = {
  lead: "neutral",
  contacted: "info",
  meeting: "info",
  proposal: "wait",
  agreement_signed: "wait",
  onboarding: "ok",
  live: "ok",
  lost: "danger",
};

export const STAGE_LABEL = Object.fromEntries(CRM_STAGES.map((s) => [s.key, s.label])) as Record<CrmStage, string>;
export { CRM_ACCOUNT_KIND_LABEL as KIND_LABEL, CRM_SOURCE_LABEL as SOURCE_LABEL };

export const CRM_BASE = "/partners/crm";
export const accountHref = (id: string) => `${CRM_BASE}/${id}`;

export const SIZE_FMT = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
