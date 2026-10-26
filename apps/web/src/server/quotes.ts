import "server-only";
import { LABELS, QUOTE_STATUS, buildDisclosure, compareQuotes, comparisonSummary, type ComparableQuote } from "@im/core";
import type { Row } from "@im/db";
import type { UserClient } from "@/server/api-auth";
import { getSetting } from "@/lib/catalog";

export type QuoteWithParties = Row<"quotes"> & {
  insurer: { id: string; name: string; slug: string; brand_color: string | null; logo_url: string | null; settings: unknown } | null;
  product: { id: string; name: string; tier: string | null } | null;
};

export function toComparable(q: QuoteWithParties): ComparableQuote {
  return {
    id: q.id,
    insurerId: q.insurer_org_id,
    insurerName: q.insurer?.name ?? "Insurer",
    productName: q.product?.name,
    status: q.status,
    premium: Number(q.premium),
    excess: q.excess === null ? null : Number(q.excess),
    sumInsured: q.sum_insured === null ? null : Number(q.sum_insured),
    coverage: (Array.isArray(q.coverage) ? q.coverage : []) as ComparableQuote["coverage"],
    exclusions: q.exclusions ?? [],
    keyExclusion: q.key_exclusion,
    waitingPeriodDays: q.waiting_period_days,
    optionalBenefits: (Array.isArray(q.optional_benefits) ? q.optional_benefits : []) as ComparableQuote["optionalBenefits"],
    validUntil: q.valid_until,
    paidPlacement: q.paid_placement,
  };
}

const QUOTE_SELECT =
  "*, insurer:organizations!quotes_insurer_org_id_fkey(id, name, slug, brand_color, logo_url, settings), product:products(id, name, tier)";

/** Quotes for a request (RLS-scoped), the comparison result and the mandatory disclosure. */
export async function loadQuotesForRequest(supabase: UserClient, requestId: string) {
  const { data: request } = await supabase
    .from("requests")
    .select("id, reference, status, customer_id, broker_org_id, broker:organizations!requests_broker_org_id_fkey(id, name, nic_licence_number, settings)")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return null;
  const { data: quotes } = await supabase.from("quotes").select(QUOTE_SELECT).eq("request_id", requestId).order("premium");
  const rows = (quotes ?? []) as unknown as QuoteWithParties[];
  const comparison = compareQuotes(rows.map(toComparable));
  const broker = request.broker as unknown as { id: string; name: string; nic_licence_number: string | null; settings: unknown } | null;
  const brand = await getSetting<{ name?: string }>("brand").catch(() => null);
  const disclosure = broker
    ? buildDisclosure({ platform: brand?.name, broker: { name: broker.name, licence: broker.nic_licence_number }, insurer: null })
    : null;
  const labelled = Object.fromEntries(comparison.ranked.map((r) => [r.quote.id, r.labels.map((l) => LABELS[l])]));
  return {
    request: { id: request.id, reference: request.reference, status: request.status, brokerOrgId: request.broker_org_id },
    broker,
    quotes: rows.map((q) => ({
      ...q,
      statusLabel: QUOTE_STATUS[q.status].label,
      statusHint: QUOTE_STATUS[q.status].customerHint ?? null,
      labels: labelled[q.id] ?? [],
      demo: !!(q.insurer?.settings as { demo?: boolean } | null)?.demo,
      expired: !!q.valid_until && new Date(q.valid_until) < new Date(),
    })),
    comparison,
    summary: comparisonSummary(comparison),
    disclosure,
    comparedAt: new Date().toISOString(),
  };
}
