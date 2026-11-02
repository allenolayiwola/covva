import Link from "next/link";
import { Logo } from "@im/ui";
import { getBrand, getCurrentYear } from "@/components/marketing/brand";

const CREAM = "#F6E9D5";
const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/cookies", label: "Cookies" },
];

/**
 * Chrome for the pre-launch teaser (lib/site-gate.ts): logo, the page, and a one-line footer with the legal pages, which
 * stay reachable while the gate is on. Deliberately says nothing about the product. No site navigation, no analytics,
 * so no cookie banner is needed.
 */
export default async function GateLayout({ children }: LayoutProps<"/">) {
  const [brand, year] = await Promise.all([getBrand(), getCurrentYear()]);
  return (
    <div data-marketing className="flex min-h-dvh flex-col items-center px-4" style={{ backgroundColor: CREAM }}>
      <header className="flex w-full justify-center pt-10 sm:pt-14">
        <Logo height={48} label={brand.name} className="[&_img]:h-10 [&_img]:w-auto sm:[&_img]:h-12" />
      </header>
      <main id="main" tabIndex={-1} className="flex w-full flex-1 items-center justify-center py-10 focus:outline-none">
        {children}
      </main>
      <footer className="flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-6 text-[13px] text-muted">
        <span>© {year} {brand.name}</span>
        <nav aria-label="Legal">
          <ul className="flex gap-x-5">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center hover:text-brand">{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}
