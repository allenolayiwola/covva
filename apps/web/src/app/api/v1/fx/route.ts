import { FxQuery, SUPPORTED_DISPLAY_CURRENCIES, fxDisclosure } from "@im/core";
import { parseQuery, withApi } from "@/server/api-auth";
import { fxSettings, getRates, quoteFx } from "@/server/fx";

/**
 * GET /api/v1/fx?currency=GBP&amount=1255.63 — indicative display rates for diaspora payers.
 * Rates are "GHS per 1 unit"; the GHS amount is always the contract amount the insurer receives.
 * Public: the rates are the same for everyone and carry no customer data.
 */
export const GET = withApi(
  async ({ req }) => {
    const q = parseQuery(req, FxQuery);
    const [rates, settings] = await Promise.all([getRates(), fxSettings()]);
    const quote = q.amount !== undefined ? await quoteFx(q.amount, q.currency) : null;
    const selected = rates[q.currency];
    return {
      base: "GHS",
      currencies: SUPPORTED_DISPLAY_CURRENCIES,
      marginPct: settings.marginPct,
      rates: Object.fromEntries(Object.entries(rates).map(([code, r]) => [code, r ? { rate: r.rate, source: r.source, fetchedAt: r.fetchedAt, validUntil: r.validUntil, manual: r.manual } : null])),
      selected: selected ? { currency: q.currency, rate: selected.rate, source: selected.source, fetchedAt: selected.fetchedAt, disclosure: fxDisclosure(q.currency, selected.rate, selected.source, selected.fetchedAt, { marginPct: settings.marginPct }) } : null,
      quote,
      indicative: true,
      note: "Indicative only. Your card issuer or payment provider applies the final rate; the insurer receives the GHS amount.",
    };
  },
  { auth: "none" },
);
