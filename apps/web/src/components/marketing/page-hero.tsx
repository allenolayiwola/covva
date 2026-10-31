import { JsonLd } from "./json-ld";
import { sitePath } from "@/lib/site-url";
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Container, Eyebrow, cn } from "@im/ui";

/** Interior page hero: breadcrumb, eyebrow, H1, lede, actions and an optional aside. */
export function PageHero({
  eyebrow,
  title,
  lede,
  actions,
  aside,
  breadcrumb,
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("relative overflow-x-clip overflow-y-clip border-b border-line bg-gradient-to-b from-mist to-white", className)}>
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-mint-2 opacity-70 blur-3xl" />
      <Container className="relative py-14 sm:py-20">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-6">
            <JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ label: "Home", href: "/" }, ...breadcrumb].map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, ...(item.href ? { item: sitePath(item.href) } : {}) })) }} />
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <li>
                <Link href="/" className="rounded hover:text-brand">Home</Link>
              </li>
              {breadcrumb.map((b, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <ChevronRight aria-hidden className="size-3.5 text-subtle" />
                  {b.href ? (
                    <Link href={b.href} className="rounded hover:text-brand">{b.label}</Link>
                  ) : (
                    <span aria-current="page" className="text-ink-2">{b.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className={cn("grid gap-10", aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-center lg:gap-16")}>
          <div className="motion-safe:animate-fade-up">
            {eyebrow && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
            <h1 className="text-balance text-h2 text-ink">{title}</h1>
            {lede && <p className="mt-5 max-w-2xl text-lead text-muted">{lede}</p>}
            {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
            {children}
          </div>
          {aside && <div className="motion-safe:animate-fade-up [animation-delay:120ms]">{aside}</div>}
        </div>
      </Container>
    </section>
  );
}
