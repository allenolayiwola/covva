import Link from "next/link";
import { ArrowRight, Building2, Handshake, PlugZap } from "lucide-react";
import { Container, buttonClass } from "@im/ui";

/** "Are you an insurer or broker? Grow with Covva." strip used on the home page (light mist band). */
export function PartnerCtaStrip() {
  const links = [
    { href: "/insurers", icon: Building2, label: "For insurers" },
    { href: "/brokers", icon: Handshake, label: "For brokers" },
    { href: "/partners/embedded", icon: PlugZap, label: "Embedded partners" },
  ];
  return (
    <section aria-labelledby="partner-strip-title" className="border-y border-line bg-mist">
      <Container className="flex flex-col gap-6 py-12 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 id="partner-strip-title" className="text-h4 text-ink">Are you an insurer or broker? Grow with Covva.</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">New customers in Ghana and the diaspora, instant digital issuance, renewals on autopilot and clean data — at the integration level that suits you.</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={buttonClass("outline", "md")}>
                <l.icon aria-hidden className="size-4 text-brand" />
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
