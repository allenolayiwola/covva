import type { Enum } from "@im/db";

export const INVOICE_TONE: Record<Enum<"invoice_status">, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  draft: "neutral",
  issued: "info",
  paid: "ok",
  overdue: "danger",
  void: "neutral",
};
