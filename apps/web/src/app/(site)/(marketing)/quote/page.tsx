import { sitePath } from "@/lib/site-url";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { RiskField } from "@im/core";
import { Container, Spinner } from "@im/ui";
import { getCategories, getPartnerDirectory } from "@/lib/catalog";
import { getPublicScoreSummaries } from "@/server/scorecards";
import { isDemoOrg } from "@/components/marketing/brand";
import { QuoteFlow } from "@/components/marketing/quote-flow/quote-flow";
import type { FlowBroker, FlowCategory } from "@/components/marketing/quote-flow/model";

export const metadata: Metadata = {
  title: "Get quotes",
  description: "Answer a few questions, choose up to three licensed brokers and get real quotes from participating insurers in Ghana. Start without an account. A quote request is not cover.",
  alternates: { canonical: "/quote" },
  robots: { index: true, follow: true },
  openGraph: { title: "Get insurance quotes · Covva", description: "One question at a time. Choose your brokers. Pay by MoMo or card when you are ready.", url: "/quote", images: [sitePath("/opengraph-image")] },
};

/**
 * Public, anonymous-first quote flow (mockups 03–05). The catalogue and the broker directory come from the
 * cached helpers so the shell prerenders; the client flow reads `?category=`/`?resume=` itself (inside Suspense).
 */
export default async function QuotePage() {
  const [categories, directory] = await Promise.all([getCategories(), getPartnerDirectory()]);
  const scores = await getPublicScoreSummaries(directory.brokers.map((b) => b.id));
  const flowCategories: FlowCategory[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    short_description: c.short_description,
    availability: c.availability,
    segment: c.segment,
    risk_schema: (c.risk_schema ?? []) as unknown as RiskField[],
  }));
  const brokers: FlowBroker[] = directory.brokers.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    region: b.region,
    nic_licence_number: b.nic_licence_number,
    logo_url: b.logo_url,
    brand_color: b.brand_color,
    demo: isDemoOrg(b.settings),
    score: scores[b.id] ? { ratingAvg: scores[b.id]!.ratingAvg, reviewCount: scores[b.id]!.reviewCount, responseBand: scores[b.id]!.responseBand, scoreBand: scores[b.id]!.scoreBand } : null,
  }));

  return (
    <div className="min-h-[70dvh] bg-gradient-to-b from-mist/70 to-white">
      <Suspense
        fallback={
          <Container className="py-16">
            <h1 className="sr-only">Get insurance quotes</h1>
            <div className="mx-auto flex max-w-xl items-center justify-center gap-3 text-muted"><Spinner className="size-5" /> Loading…</div>
          </Container>
        }
      >
        <QuoteFlow categories={flowCategories} brokers={brokers} />
      </Suspense>
    </div>
  );
}
