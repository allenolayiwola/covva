import Link from "next/link";
import { Container, Logo } from "@im/ui";
import { getBrand, getCurrentYear } from "@/components/marketing/brand";
import { TRUST_STATEMENT } from "@/components/marketing/trust-copy";

const CREAM = "#F6E9D5";
const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy notice" },
  { href: "/legal/terms", label: "Terms of use" },
  { href: "/legal/cookies", label: "Cookies" },
];

/**
 * Chrome for the pre-launch waitlist (lib/site-gate.ts): logo, the page, and a short footer with the legal pages, which
 * stay reachable while the gate is on. No site navigation (every other page shows this one while gated), no analytics,
 * so no cookie banner is needed.
 */
export default async function GateLayout({ children }: LayoutProps<"/">) {
  const [brand, year] = await Promise.all([getBrand(), getCurrentYear()]);
  return (
    <div data-marketing className="flex min-h-dvh flex-col" style={{ backgroundColor: CREAM }}>
      <header>
        <Container className="flex h-16 items-center justify-between gap-4 sm:h-20">
          <Logo height={40} label={brand.name} className="[&_img]:h-8 [&_img]:w-auto sm:[&_img]:h-10" />
          <a href={`mailto:${brand.supportEmail}`} className="inline-flex min-h-11 items-center text-sm font-medium text-[#0d4a43] hover:underline">
            {brand.supportEmail}
          </a>
        </Container>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <footer className="border-t border-line bg-white">
        <Container className="flex flex-col gap-4 py-8 text-sm text-muted md:flex-row md:items-start md:justify-between">
          <div className="max-w-[640px] space-y-2">
            <p>{TRUST_STATEMENT} Covva is not an insurer or a broker and never holds your premium.</p>
            <p>© {year} {brand.name}</p>
          </div>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {LEGAL_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-11 items-center hover:text-brand">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </footer>
    </div>
  );
}
