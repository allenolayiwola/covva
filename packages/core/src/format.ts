export function formatGHS(amount: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  const n = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(amount);
  return `GH₵ ${n}`;
}

export function formatDate(value: string | Date | null | undefined, style: "short" | "long" = "short"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", style === "long"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function daysUntil(value: string | Date | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export function relativeDue(value: string | Date | null | undefined, now = new Date()): { label: string; atRisk: boolean; overdue: boolean } {
  if (!value) return { label: "No due date", atRisk: false, overdue: false };
  const d = typeof value === "string" ? new Date(value) : value;
  const hours = (d.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return { label: "Overdue", atRisk: true, overdue: true };
  const sameDay = d.toDateString() === now.toDateString();
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(d);
  if (sameDay) return { label: `Today, ${time}`, atRisk: hours < 4, overdue: false };
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return { label: "Tomorrow", atRisk: false, overdue: false };
  return { label: formatDate(d), atRisk: false, overdue: false };
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
