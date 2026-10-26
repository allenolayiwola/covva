import type { ClaimStatus } from "@im/core";

/** Insurer claim workflow steps (decisions are recorded separately). */
export const INSURER_STEPS: Partial<Record<ClaimStatus, ClaimStatus[]>> = {
  reported: ["acknowledged"],
  delivered_to_insurer: ["acknowledged"],
  acknowledged: ["under_assessment", "info_requested"],
  under_assessment: ["info_requested"],
  info_requested: ["under_assessment"],
  rejected: ["closed"],
  paid: ["closed"],
};

/** Statuses from which the insurer may record a decision. */
export const DECIDABLE: ClaimStatus[] = ["acknowledged", "under_assessment", "info_requested"];
