import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass, onDarkButtonClass } from "./ui-classes";

/** Closing teal call-to-action band used at the bottom of most marketing pages. */
export function CtaBand({
  title = "Ready when you are.",
  body = "Start with a few questions, or go straight to the cover you know you need. A named broker is with you at every step.",
  primary = { label: "What do I need?", href: "/get-started" },
  secondary = { label: "Explore cover", href: "/explore" },
}: {
  title?: React.ReactNode;
  body?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string } | null;
}) {
  return (
    <section aria-labelledby="cta-band-title" className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
      <div className="relative mx-auto max-w-[1136px] overflow-hidden rounded-[28px] bg-brand-deep px-6 py-14 text-white sm:px-12 sm:py-16">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-40 size-72 rounded-full bg-brand/40 blur-2xl" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 id="cta-band-title" className="text-balance text-[30px] font-bold leading-tight tracking-[-0.025em] sm:text-[40px]">
              {title}
            </h2>
            <p className="mt-3 text-[17px] leading-relaxed text-white/80">{body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={primary.href} className={buttonClass("white", "lg")}>
              {primary.label}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            {secondary && (
              <Link
                href={secondary.href}
                className={onDarkButtonClass()}
              >
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
