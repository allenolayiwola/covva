import type { Tone } from "@im/core";

/**
 * Indicative claim service levels used for oversight (not contractual):
 *  - reported → delivered to insurer within 1 business day (24h)
 *  - delivered → acknowledged by insurer within 2 days (48h)
 *  - acknowledged → decision within 30 days
 */
export function claimSla(c: {
  status: string;
  reported_at: string | null;
  delivered_to_insurer_at: string | null;
  acknowledged_at: string | null;
}): { label: string; tone: Tone } | null {
  const now = Date.now();
  const h = (iso: string) => (now - new Date(iso).getTime()) / 3_600_000;
  if (c.status === "reported" && c.reported_at) {
    const age = h(c.reported_at);
    return age > 24 ? { label: `Not delivered · ${Math.round(age)}h`, tone: "danger" } : { label: "Awaiting delivery", tone: "wait" };
  }
  if (c.status === "delivered_to_insurer" && c.delivered_to_insurer_at) {
    const age = h(c.delivered_to_insurer_at);
    return age > 48 ? { label: `No acknowledgement · ${Math.round(age / 24)}d`, tone: "danger" } : { label: "Awaiting insurer", tone: "wait" };
  }
  if (["acknowledged", "under_assessment", "info_requested"].includes(c.status) && c.acknowledged_at) {
    const days = h(c.acknowledged_at) / 24;
    return days > 30 ? { label: `Decision overdue · ${Math.round(days)}d`, tone: "danger" } : { label: `Day ${Math.ceil(days)} of 30`, tone: "info" };
  }
  return null;
}
