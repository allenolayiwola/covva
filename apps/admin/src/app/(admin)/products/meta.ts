import type { Enum } from "@im/db";

export const PRODUCT_TONE: Record<Enum<"product_status">, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  approved: "ok",
  pending_approval: "wait",
  draft: "neutral",
  suspended: "danger",
  retired: "neutral",
};

export const COMPLIANCE_TONE: Record<string, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  draft: "neutral",
  submitted: "wait",
  in_review: "info",
  returned: "danger",
  published: "ok",
};

export const RATE_TABLE_TONE: Record<string, "ok" | "wait" | "danger" | "neutral" | "info"> = {
  draft: "neutral",
  pending_review: "wait",
  approved: "ok",
  rejected: "danger",
};

/** Tabs shared by the product catalogue pages (counts are optional badges). */
export function CATALOGUE_TABS(counts: { queue?: number; compliance?: number; rateTables?: number; templates?: number } = {}) {
  return [
    { key: "all", label: "All products", href: "/products" },
    { key: "queue", label: "Review queue", href: "/products?view=queue", count: counts.queue },
    { key: "compliance", label: "Compliance", href: "/products/compliance", count: counts.compliance },
    { key: "rate-tables", label: "Rate tables", href: "/products/rate-tables", count: counts.rateTables },
    { key: "templates", label: "Templates", href: "/products/templates", count: counts.templates },
  ];
}
