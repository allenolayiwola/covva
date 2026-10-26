import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Container, DemoBadge } from "@im/ui";
import type { PublicOrg } from "@/lib/catalog";
import { displayOrgName, isDemoOrg } from "./brand";
import { OrgTile } from "./org-tile";
import { PaymentBadges, SecurityBadges } from "./payment-badges";

/** Home trust bar: partner insurer logos, "Licensed partners only", payment and security badges. */
export function TrustBar({ insurers, demo }: { insurers: PublicOrg[]; demo: boolean }) {
  const anyDemo = demo || insurers.some((i) => isDemoOrg(i.settings));
  return (
    <section aria-labelledby="trust-bar-title" className="border-y border-line bg-white">
      <Container className="py-8 sm:py-10">
        <h2 id="trust-bar-title" className="sr-only">Trusted partners and secure payments</h2>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
          <div>
            <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-brand">
              <BadgeCheck aria-hidden className="size-4" />
              Licensed partners only
            </p>
            <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3" aria-label="Participating insurers">
              {insurers.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center gap-2.5">
                  <OrgTile name={i.name} color={i.brand_color} size={30} />
                  <span className="text-[15px] font-medium text-ink-2">{displayOrgName(i.name)}</span>
                </li>
              ))}
              <li>
                <Link href="/partners" className="rounded text-[14px] font-semibold text-brand underline-offset-4 hover:underline">All partners</Link>
              </li>
            </ul>
            {anyDemo && <DemoBadge className="mt-3" />}
          </div>
          <div className="space-y-3">
            <PaymentBadges compact />
            <SecurityBadges compact />
          </div>
        </div>
      </Container>
    </section>
  );
}
