import Link from "next/link";
import { ArrowRight, Building2, Handshake, PlugZap } from "lucide-react";
import { Container } from "@im/ui";

/** "Are you an insurer or broker? Grow with Covva." strip used on the home page. */
export function PartnerCtaStrip() {
  const links = [
    { href: "/insurers", icon: Building2, label: "For insurers" },
    { href: "/brokers", icon: Handshake, label: "For brokers" },
    { href: "/partners/embedded", icon: PlugZap, label: "Embedded partners" },
  ];
  return (
    <section aria-labelledby="partner-strip-title" className="bg-ink text-white">
      <Container className="flex flex-col gap-6 py-10 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 id="partner-strip-title" className="text-[24px] font-bold leading-tight tracking-[-0.02em] sm:text-[28px]">Are you an insurer or broker? Grow with Covva.</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/75">New customers in Ghana and the diaspora, instant digital issuance, renewals on autopilot and clean data — at the integration level that suits you.</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-white/10 px-4 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <l.icon aria-hidden className="size-4 text-mint" />
                {l.label}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
