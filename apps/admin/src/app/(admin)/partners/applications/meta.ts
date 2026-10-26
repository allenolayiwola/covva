/** Partner application statuses (partner_applications.status) and their display tones. Safe for client components. */
export const STATUSES = ["submitted", "in_review", "needs_changes", "approved", "rejected", "draft"] as const;
export type ApplicationStatus = (typeof STATUSES)[number];
export const STATUS_TONE: Record<string, "info" | "wait" | "ok" | "danger" | "neutral"> = {
  draft: "neutral",
  submitted: "wait",
  in_review: "info",
  needs_changes: "danger",
  approved: "ok",
  rejected: "neutral",
};
