import type { Metadata } from "next";
import { Suspense } from "react";
import { Clock, Lock, UserRoundCheck } from "lucide-react";
import { Container, Eyebrow } from "@im/ui";
import { getCategories } from "@/lib/catalog";
import { NeedsWizard } from "@/components/marketing/needs-wizard";
import { QuoteIntent } from "@/components/marketing/quote-intent";

export const metadata: Metadata = {
  title: "Help me choose",
  description:
    "Not sure what insurance you need? Answer eight quick questions about your life, work and what you own, and see which cover is worth considering — and why. Explore without signing in; an account is needed to start a request.",
  alternates: { canonical: "/get-started" },
};

export default async function GetStartedPage({ searchParams }: PageProps<"/get-started">) {
  const categories = await getCategories();
  const slim = categories.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, availability: c.availability }));

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-mist to-white">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[480px] rounded-full bg-mint-2 opacity-70 blur-3xl" />
      <Container className="relative py-12 sm:py-16">
        {/* searchParams are request-time data: stream the quote-intent card inside Suspense. */}
        <Suspense fallback={null}>
          <QuoteIntent searchParams={searchParams} />
        </Suspense>
        <header className="mx-auto max-w-2xl text-center">
          <Eyebrow>Help me choose</Eyebrow>
          <h1 className="mt-4 text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[46px]">
            What cover do I actually need?
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Eight quick questions. We suggest what is worth considering and explain why — not just the cheapest option.
          </p>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted">
            <li className="flex items-center gap-1.5"><Clock aria-hidden className="size-4 text-brand" />About 2 minutes</li>
            <li className="flex items-center gap-1.5"><Lock aria-hidden className="size-4 text-brand" />Explore without signing in. An account is needed to start a request.</li>
            <li className="flex items-center gap-1.5"><UserRoundCheck aria-hidden className="size-4 text-brand" />Reviewed by a broker before you apply</li>
          </ul>
        </header>
        <div className="mt-12 rounded-[28px] border border-line bg-white p-5 shadow-float sm:p-10">
          <NeedsWizard categories={slim} />
        </div>
      </Container>
    </div>
  );
}
