import Link from "next/link";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { Container, buttonClass } from "@im/ui";
import type { PageBlockView, PartnerView } from "@/server/cms";
import { CtaBand } from "./cta-band";
import { FaqList } from "./faq-list";
import { PageHero } from "./page-hero";
import { PartnerLogos } from "./partner-logos";
import { RichText } from "./rich-text";
import { Section, SectionHeading } from "./section";
import { Testimonials } from "./testimonials";

/**
 * Renders a CMS page's blocks with the marketing components the hand-written pages use, so a
 * CMS page looks like the rest of the site (tokens, 13px minimum text, 40px tap targets).
 */
export function CmsPageBlocks({ blocks, partners }: { blocks: PageBlockView[]; partners: PartnerView[] | null }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "hero":
            return (
              <PageHero
                key={b.id}
                eyebrow={b.eyebrow ?? undefined}
                title={b.title}
                lede={b.lede ?? undefined}
                actions={
                  b.primary || b.secondary ? (
                    <>
                      {b.primary && <Link href={b.primary.href} className={buttonClass("primary", "lg")}>{b.primary.label} <ArrowRight aria-hidden className="size-4" /></Link>}
                      {b.secondary && <Link href={b.secondary.href} className={buttonClass("secondary", "lg")}>{b.secondary.label}</Link>}
                    </>
                  ) : undefined
                }
              />
            );
          case "richText":
            return (
              <Container key={b.id} className={i === 0 ? "py-12 sm:py-16" : "py-6 sm:py-8"}>
                <RichText nodes={b.content} className="max-w-3xl" />
              </Container>
            );
          case "faqList":
            return (
              <Section key={b.id} labelledBy={`block-${b.id}`}>
                <SectionHeading id={`block-${b.id}`} eyebrow="Questions" title={b.heading ?? "Good to know"} />
                {b.items.length > 0 ? <FaqList items={b.items} className="max-w-3xl" /> : <p className="text-sm text-muted">No published questions in this list yet.</p>}
              </Section>
            );
          case "ctaBand":
            return <CtaBand key={b.id} title={b.title} body={b.body ?? undefined} primary={b.primary} secondary={b.secondary} />;
          case "partnerStrip": {
            const shown = (partners ?? []).filter((p) => b.types.includes(p.type));
            return (
              <section key={b.id} aria-labelledby={`block-${b.id}`} className="border-y border-line bg-white">
                <Container className="py-8 sm:py-10">
                  <h2 id={`block-${b.id}`} className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-brand">
                    <BadgeCheck aria-hidden className="size-4" />
                    {/* Always the licensed-partners statement, whatever the editor typed as a heading. */}
                    Licensed partners only
                  </h2>
                  {b.heading && b.heading !== "Licensed partners only" && <p className="mt-2 text-[15px] text-muted">{b.heading}</p>}
                  {shown.length > 0 ? (
                    <PartnerLogos partners={shown} className="mt-4" />
                  ) : (
                    <p className="mt-3 text-[14px] text-muted">
                      See the <Link href="/partners" className="font-medium text-brand hover:underline">partner directory</Link> for every participating insurer and broker.
                    </p>
                  )}
                </Container>
              </section>
            );
          }
          case "testimonialStrip":
            return (
              <Section key={b.id} labelledBy={`block-${b.id}`}>
                <SectionHeading
                  id={`block-${b.id}`}
                  eyebrow="What people say"
                  title={b.heading ?? "Stories from customers"}
                  description={b.items.some((t) => t.illustrative) ? "Quotes marked “Illustrative” are examples of how Covva is designed to work, not real customer reviews." : undefined}
                />
                <Testimonials items={b.items} />
              </Section>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
