"use client";

import { ArrowRight, Zap } from "lucide-react";
import { formatGHS } from "@im/core";
import { Pill, Spinner, buttonClass } from "@im/ui";
import type { DirectOfferView } from "@/app/(site)/(public)/quote/actions";
import { OrgTile } from "../org-tile";
import { DIRECT_QUOTE_DISCLOSURE } from "../trust-copy";

/**
 * Instant offers from insurers that sell this cover directly (server/direct-quotes.ts). Choosing one places the
 * order with that insurer and opens checkout with a binding price. The footnote is the shared commission disclosure.
 */
export function DirectOffers({ offers, busyId, disabled, onBuy }: { offers: DirectOfferView[]; busyId: string | null; disabled: boolean; onBuy: (offer: DirectOfferView) => void }) {
  return (
    <section aria-labelledby="direct-offers-title" className="mt-8">
      <h2 id="direct-offers-title" className="text-xl font-semibold text-ink">Buy directly from the insurer</h2>
      <p className="mt-1 text-[15px] text-muted">Priced from your answers. You review the cover and declarations before paying.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Direct offers">
        {offers.map((o) => (
          <li key={o.productId} className="flex h-full flex-col gap-4 rounded-card border border-line bg-white p-5">
            <div className="flex items-start gap-3">
              <OrgTile name={o.insurerName} size={44} />
              <div className="min-w-0">
                <p className="font-semibold text-ink">{o.insurerName}</p>
                <p className="text-sm text-muted">{o.productName}</p>
              </div>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink">{formatGHS(o.premium)}</p>
              <p className="text-sm text-muted">per year</p>
            </div>
            <Pill tone="ok" className="self-start"><Zap aria-hidden className="size-3.5" /> {o.issuanceLabel}</Pill>
            <button type="button" onClick={() => onBuy(o)} disabled={disabled} className={buttonClass("primary", "md", "mt-auto w-full")}>
              {busyId === o.productId ? <><Spinner className="size-4" /> Preparing…</> : <>Buy from {o.insurerName} <ArrowRight aria-hidden className="size-4" /></>}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted">{DIRECT_QUOTE_DISCLOSURE}</p>
    </section>
  );
}
