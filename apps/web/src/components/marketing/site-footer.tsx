import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { Container, DemoBadge, Logo } from "@im/ui";
import { ROLE_STATEMENTS } from "@im/core";
import { getBrand, getCurrentYear, isDemoMode } from "./brand";
import { REGULATION } from "./content";
import { StoreBadges } from "./store-badges";
import { PaymentBadges } from "./payment-badges";
import { PRODUCT_LINES } from "./products-content";
import type { MessageKey } from "@im/core";
import { T } from "@/lib/i18n/client";

/** Footer columns. `label` is the English text; `k` its catalogue key (translated client-side). */
const COLUMNS: { title: string; titleKey: MessageKey; links: { href: string; label: string; k: MessageKey }[] }[] = [
  {
    title: "Get started", titleKey: "footer.col.getStarted",
    links: [
      { href: "/get-started", label: "Help me choose", k: "nav.helpChoose" },
      { href: "/diaspora", label: "Diaspora", k: "nav.diaspora" },
      { href: "/business", label: "Business", k: "nav.business" },
      { href: "/claims", label: "Claims", k: "nav.claims" },
      { href: "/verify", label: "Verify a policy", k: "footer.verifyPolicy" },
      { href: "/learn", label: "Learn", k: "nav.learn" },
      { href: "/account", label: "My account", k: "header.myAccount" },
    ],
  },
  {
    title: "Partners", titleKey: "footer.col.partners",
    links: [
      { href: "/insurers", label: "For insurers", k: "nav.insurers.label" },
      { href: "/brokers", label: "For brokers", k: "nav.brokers.label" },
      { href: "/partners/embedded", label: "Embedded partners", k: "nav.embedded.label" },
      { href: "/partners", label: "Partner directory", k: "nav.directory.label" },
      { href: "/waitlist", label: "Launch partners", k: "footer.launchPartners" },
    ],
  },
  {
    title: "Company", titleKey: "footer.col.company",
    links: [
      { href: "/about", label: "About us", k: "footer.aboutUs" },
      { href: "/trust", label: "Regulation & protection", k: "nav.trust" },
      { href: "/how-it-works", label: "How it works", k: "nav.howItWorks" },
      { href: "/referrals", label: "Refer a friend", k: "nav.referrals" },
      { href: "/press", label: "Press & media kit", k: "nav.press" },
      { href: "/support", label: "Help centre", k: "nav.helpCentre" },
      { href: "/contact", label: "Contact", k: "nav.contact" },
    ],
  },
  {
    title: "Legal", titleKey: "footer.col.legal",
    links: [
      { href: "/legal/terms", label: "Terms of use", k: "footer.terms" },
      { href: "/legal/privacy", label: "Privacy notice", k: "footer.privacy" },
      { href: "/legal/complaints", label: "Complaints procedure", k: "footer.complaints" },
      { href: "/legal/disclosures", label: "Disclosures", k: "footer.disclosures" },
      { href: "/legal/cookies", label: "Cookies", k: "footer.cookies" },
    ],
  },
];

export async function SiteFooter() {
  const [brand, year, demo] = await Promise.all([getBrand(), getCurrentYear(), isDemoMode()]);

  return (
    <footer className="border-t border-line bg-mist" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only"><T k="footer.heading" /></h2>
      <Container className="py-14 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex min-h-11 min-w-11 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <Logo height={36} label={brand.name} />
            </Link>
            <p className="mt-4 text-[15px] font-medium text-ink-2">{brand.tagline}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">{ROLE_STATEMENTS.platform}</p>
            <a href={`mailto:${brand.supportEmail}`} className="mt-5 inline-flex min-h-11 min-w-11 items-center gap-2 rounded text-sm font-medium text-brand hover:underline">
              <Mail aria-hidden className="size-4" />
              {brand.supportEmail}
            </a>
            <div className="mt-6" aria-label="Mobile apps">
              <StoreBadges size="sm" />
            </div>
            <PaymentBadges compact className="mt-5" />
            {demo && <DemoBadge className="mt-5 text-sm!" />}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <h3 className="text-sm font-semibold text-ink"><T k="footer.col.insurance" /></h3>
              <ul className="mt-2 text-sm">
                {PRODUCT_LINES.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/insurance/${p.slug}`} className="inline-flex min-h-11 min-w-11 items-center rounded text-muted hover:text-brand">{p.short}</Link>
                  </li>
                ))}
                <li>
                  <Link href="/explore" className="inline-flex min-h-11 min-w-11 items-center rounded font-medium text-brand hover:underline"><T k="footer.allCover" /></Link>
                </li>
              </ul>
            </div>
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-ink"><T k={col.titleKey} /></h3>
                <ul className="mt-2 text-sm">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="inline-flex min-h-11 min-w-11 items-center rounded text-muted hover:text-brand"><T k={l.k} /></Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-4 rounded-card border border-line bg-white p-5 text-sm leading-relaxed text-muted sm:p-6 md:grid-cols-3">
          <p>
            <span className="font-semibold text-ink">Broking. </span>
            Insurance broking services are provided by participating brokers licensed by the{" "}
            <a href={REGULATION.nic.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-0.5 font-medium text-brand hover:underline">
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
            {brand.workingName ? <T k="footer.workingName" /> : ""}<T k="footer.platformLine" />
          </p>
          <p className="text-sm">
            <Link href="/legal/cookies" className="inline-flex min-h-11 min-w-11 items-center rounded hover:text-brand"><T k="footer.cookiesConsent" /></Link>
          </p>
        </div>
      </Container>
    </footer>
  );
}
