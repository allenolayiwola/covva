import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow, buttonClass } from "@im/ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

const CATEGORIES = [
  { href: "/insurance/motor", label: "Motor" },
  { href: "/insurance/home", label: "Home & contents" },
  { href: "/insurance/health", label: "Health" },
  { href: "/insurance/travel", label: "Travel" },
  { href: "/insurance/life-funeral", label: "Life & funeral" },
  { href: "/insurance/business", label: "Business" },
  { href: "/insurance/micro", label: "Micro-insurance" },
] as const;

/** Root 404: rendered outside any route group, so it brings its own header and footer. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="bg-gradient-to-b from-mist to-white focus:outline-none">
        <Container className="py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Page not found</Eyebrow>
            <h1 className="mt-4 text-[38px] font-bold leading-tight tracking-[-0.035em] text-ink sm:text-[52px]">We couldn’t find that page.</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">It may have moved, or the link may be incomplete. Start a quote, or pick a type of cover below.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/quote" className={buttonClass("primary", "lg")}>Get quotes</Link>
              <Link href="/" className={buttonClass("secondary", "lg")}>Back to home</Link>
            </div>
          </div>
          <nav aria-label="Insurance categories" className="mx-auto mt-12 max-w-3xl">
            <ul className="flex flex-wrap justify-center gap-2">
              {CATEGORIES.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="inline-flex min-h-10 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
