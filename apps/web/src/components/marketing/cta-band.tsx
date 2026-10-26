import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, buttonClass } from "@im/ui";

/** Closing call-to-action band at the bottom of most marketing pages. Light mint card (no dark sections). */
export function CtaBand({
  title = "Ready when you are.",
  body = "Start with a few questions, or go straight to the cover you know you need. A named broker is with you at every step.",
  primary = { label: "Get quotes", href: "/quote" },
  secondary = { label: "Explore cover", href: "/explore" },
}: {
  title?: React.ReactNode;
  body?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string } | null;
}) {
  return (
    <section aria-labelledby="cta-band-title" className="pb-16 lg:pb-24">
      <Container>
        <div className="relative overflow-hidden rounded-hero border border-line bg-mint/60 px-6 py-14 sm:px-12 sm:py-16">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/60" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h2 id="cta-band-title" className="text-balance text-h2 text-ink">{title}</h2>
              <p className="mt-3 text-lead text-muted">{body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={primary.href} className={buttonClass("primary", "lg")}>
                {primary.label}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              {secondary && (
                <Link href={secondary.href} className={buttonClass("outline", "lg")}>
                  {secondary.label}
                </Link>
              )}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
