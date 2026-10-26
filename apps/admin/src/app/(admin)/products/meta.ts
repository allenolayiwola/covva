import type { Enum } from "@im/db";

export const PRODUCT_TONE: Record<Enum<"product_status">, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  approved: "ok",
  pending_approval: "wait",
  draft: "neutral",
  suspended: "danger",
  retired: "neutral",
};
