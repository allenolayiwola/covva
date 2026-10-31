import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Container } from "@im/ui";
import { isVerifiedPartner } from "@/lib/partner-trust";
import type { TrustPartner } from "@/lib/catalog";
import type { PartnerView } from "@/server/cms";
import { displayOrgName } from "./brand";
import { OrgTile } from "./org-tile";
import { PartnerLogos } from "./partner-logos";
import { PaymentBadges, SecurityBadges } from "./payment-badges";

/**
 * Opt-in trust strip. CMS presentation never substitutes for the directory licence check.
 * Demo mode, demo records, inactive and unverified organisations fail closed.
 */
export function TrustBar({ organizations, demo, partners }: { organizations: TrustPartner[]; demo: boolean; partners?: PartnerView[] | null }) {
  const verifiedPartners = organizations.filter(isVerifiedPartner);
  if (process.env.HOME_PARTNER_STRIP_ENABLED !== "true" || demo || verifiedPartners.length === 0) return null;
  const cmsInsurers = (partners ?? []).filter((p) => (p.type === "insurer" || p.type === "broker") && verifiedPartners.some((i) => i.slug === p.slug));
  const cmsPayments = (partners ?? []).filter((p) => p.type === "payment" && p.logo);
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
            {cmsInsurers.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <PartnerLogos partners={cmsInsurers.slice(0, 6)} />
                <Link href="/partners" className="rounded text-[14px] font-semibold text-brand underline-offset-4 hover:underline">All partners</Link>
              </div>
            ) : (
              <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3" aria-label="Participating partners">
                {verifiedPartners.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5">
                    <OrgTile name={i.name} color={i.brand_color} size={30} />
                    <span className="text-[15px] font-medium text-ink-2">{displayOrgName(i.name)}</span>
                  </li>
                ))}
                <li>
                  <Link href="/partners" className="rounded text-[14px] font-semibold text-brand underline-offset-4 hover:underline">All partners</Link>
                </li>
              </ul>
            )}
          </div>
          <div className="space-y-3">
            {cmsPayments.length > 0 ? <PartnerLogos partners={cmsPayments} aria-label="Accepted payment methods" /> : <PaymentBadges compact />}
            <SecurityBadges compact />
          </div>
        </div>
      </Container>
    </section>
  );
}
