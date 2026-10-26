import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { Container, DemoBadge, Logo } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";
import { getBrand, getCurrentYear, isDemoMode } from "./brand";
import { REGULATION } from "./content";
import { StoreBadges } from "./store-badges";
import { PaymentBadges } from "./payment-badges";
import { PRODUCT_LINES } from "./products-content";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Get started",
    links: [
      { href: "/get-started", label: "Help me choose" },
      { href: "/diaspora", label: "Diaspora" },
      { href: "/business", label: "Business" },
      { href: "/claims", label: "Claims" },
      { href: "/verify", label: "Verify a policy" },
      { href: "/learn", label: "Learn" },
      { href: "/account", label: "My account" },
    ],
  },
  {
    title: "Partners",
    links: [
      { href: "/insurers", label: "For insurers" },
      { href: "/brokers", label: "For brokers" },
      { href: "/partners/embedded", label: "Embedded partners" },
      { href: "/partners", label: "Partner directory" },
      { href: "/waitlist", label: "Launch partners" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About us" },
      { href: "/trust", label: "Regulation & protection" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/referrals", label: "Refer a friend" },
      { href: "/press", label: "Press & media kit" },
      { href: "/support", label: "Help centre" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of use" },
      { href: "/legal/privacy", label: "Privacy notice" },
      { href: "/legal/complaints", label: "Complaints procedure" },
      { href: "/legal/disclosures", label: "Disclosures" },
      { href: "/legal/cookies", label: "Cookies" },
    ],
  },
];

export async function SiteFooter() {
  const [brand, year, demo] = await Promise.all([getBrand(), getCurrentYear(), isDemoMode()]);

  return (
    <footer className="border-t border-line bg-mist" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Footer</h2>
      <Container className="py-14 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <Logo height={36} label={brand.name} />
            </Link>
            <p className="mt-4 text-[15px] font-medium text-ink-2">{brand.tagline}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">{ROLE_STATEMENTS.platform}</p>
            <a href={`mailto:${brand.supportEmail}`} className="mt-5 inline-flex items-center gap-2 rounded text-sm font-medium text-brand hover:underline">
              <Mail aria-hidden className="size-4" />
              {brand.supportEmail}
            </a>
            <div className="mt-6" aria-label="Mobile apps">
              <StoreBadges size="sm" />
            </div>
            <PaymentBadges compact className="mt-5" />
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <h3 className="text-sm font-semibold text-ink">Insurance</h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {PRODUCT_LINES.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/insurance/${p.slug}`} className="rounded text-muted hover:text-brand">{p.short}</Link>
                  </li>
                ))}
                <li>
                  <Link href="/explore" className="rounded font-medium text-brand hover:underline">All cover</Link>
                </li>
              </ul>
            </div>
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-ink">{col.title}</h3>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="rounded text-muted hover:text-brand">{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-4 rounded-card border border-line bg-white p-5 text-[13px] leading-relaxed text-muted sm:p-6 md:grid-cols-3">
          <p>
            <span className="font-semibold text-ink">Broking. </span>
            Insurance broking services are provided by participating brokers licensed by the{" "}
            <a href={REGULATION.nic.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline">
              NIC<ExternalLink aria-hidden className="size-3" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
            . Your broker of record is named before any advice or application.
          </p>
          <p>
            <span className="font-semibold text-ink">Insurance. </span>
            Policies are underwritten and issued by participating licensed insurers under the {REGULATION.act1061}. We compare participating insurers only, not the whole market.
          </p>
          <p>
            <span className="font-semibold text-ink">Your data. </span>
            Personal data is processed under the {REGULATION.act843}. {ROLE_STATEMENTS.payment}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-line pt-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}
            {brand.workingName ? " (working name)" : ""}. Technology platform. Not an insurer or broker.
          </p>
          <p className="text-[13px]">
            <Link href="/legal/cookies" className="rounded hover:text-brand">Cookies & consent</Link>
          </p>
          {demo && <DemoBadge />}
        </div>
      </Container>
    </footer>
  );
}
