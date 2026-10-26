import { formatGHS } from "./format";

/** The quote summary a shared comparison exposes: no customer identity, no request reference. */
export interface SharedQuote {
  insurerName: string;
  productName?: string | null;
  premium: number;
  billingPeriod?: "year" | "month" | string | null;
  excess?: number | null;
  sumInsured?: number | null;
  status: string;
  keyExclusion?: string | null;
}

export interface ShareTextInput {
  categoryName?: string | null;
  /** e.g. "Toyota Corolla 2020" — risk summary only, never a name. */
  riskTitle?: string | null;
  quotes: SharedQuote[];
  url: string;
  insurersCompared?: number;
}

const MAX_LINES = 5;

/** Plain-text summary for WhatsApp / SMS (`https://wa.me/?text=` safe once URL-encoded). */
export function shareText(input: ShareTextInput): string {
  const live = input.quotes.filter((q) => q.premium > 0).sort((a, b) => a.premium - b.premium);
  const insurers = input.insurersCompared ?? new Set(live.map((q) => q.insurerName)).size;
  const head = [input.categoryName ? `${input.categoryName} quotes` : "Insurance quotes", input.riskTitle].filter(Boolean).join(" · ");
  const lines = live.slice(0, MAX_LINES).map((q) => {
    const per = q.billingPeriod === "month" ? "/mo" : "/yr";
    const bits = [`${q.insurerName}: ${formatGHS(q.premium)}${per}`];
    if (q.excess != null) bits.push(`excess ${formatGHS(q.excess)}`);
    if (q.status !== "ready_to_accept") bits.push("estimate");
    return `• ${bits.join(", ")}`;
  });
  if (live.length > MAX_LINES) lines.push(`• +${live.length - MAX_LINES} more`);
  const compared = `${insurers} insurer${insurers === 1 ? "" : "s"} compared on Covva${insurers === 1 ? " — every licensed insurer that quoted for this risk" : ""}.`;
  return [head, ...lines, compared, `See the full comparison: ${input.url}`].join("\n");
}

/** `https://wa.me/?text=…` link that opens WhatsApp with the share text prefilled. */
export function whatsappShareLink(text: string, phone?: string | null): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Share tokens are 48 hex chars (24 random bytes). */
export const SHARE_TOKEN_RE = /^[a-f0-9]{48}$/;
