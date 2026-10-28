import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@im/ui";
import type { RiskField } from "@im/core";
import { getCategories } from "@/lib/catalog";
import { siteUrl } from "@/server/api-auth";
import { embedFieldsFor, getEmbedPartner } from "@/server/referrals";
import { EmbedQuote, type EmbedCategory } from "./embed-quote";
import { HeightReporter } from "./height-reporter";

export const metadata: Metadata = { title: "Get a quote" };

export default function EmbedQuotePage({ searchParams }: PageProps<"/embed/quote">) {
  return (
    <>
      <HeightReporter />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-mist" aria-busy="true" aria-label="Loading quotes" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/embed/quote">, "searchParams">) {
  const sp = await searchParams;
  const partner = await getEmbedPartner(sp.partner);
  const base = siteUrl();
  if (!partner) {
    return (
      <div className="mx-auto max-w-md py-8 text-center" data-testid="embed-unavailable">
        <Logo height={32} />
        <h1 className="mt-5 text-lg font-semibold text-ink">Quotes aren&apos;t available here right now</h1>
        <p className="mt-2 text-sm text-muted">This quote widget isn&apos;t set up yet or has been switched off. You can still compare cover from licensed insurers on Covva.</p>
        <a href={base} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white">Visit covva.com.gh</a>
      </div>
    );
  }
  const all = await getCategories();
  const categories: EmbedCategory[] = all
    .filter((c) => c.availability !== "planned" && (!partner.allowedCategories.length || partner.allowedCategories.includes(c.slug)))
    .map((c) => ({ slug: c.slug, name: c.name, fields: embedFieldsFor(c.slug, (c.risk_schema ?? []) as unknown as RiskField[]) }));
  const wanted = typeof sp.category === "string" ? sp.category : "";
  const initial = categories.find((c) => c.slug === wanted)?.slug ?? categories[0]?.slug ?? "";
  const colour = partner.primaryColour ?? "#00796E";
  return (
    <div className="mx-auto max-w-md">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Logo height={28} />
        <div className="flex min-w-0 items-center gap-2 text-right text-xs text-muted">
          <span className="truncate">with {partner.orgName}</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- partner logo on an arbitrary https host */}
          {partner.logoUrl && <img src={partner.logoUrl} alt="" width={28} height={28} className="size-7 rounded object-contain" />}
        </div>
      </header>
      {categories.length ? (
        <EmbedQuote partner={partner.code} categories={categories} initial={initial} colour={colour} siteUrl={base} />
      ) : (
        <p className="py-6 text-center text-sm text-muted" data-testid="embed-unavailable">No cover types are enabled for this widget yet.</p>
      )}
    </div>
  );
}
