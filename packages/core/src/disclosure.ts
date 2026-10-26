/**
 * Mandatory transaction disclosure (strategy doc §5).
 * "Technology provided by [Platform]. Insurance broking services provided by
 *  [Broker], NIC licence number [number]. This policy is underwritten and issued by [Insurer]."
 */
export interface DisclosureParties {
  platform?: string;
  broker: { name: string; licence?: string | null };
  insurer?: { name: string } | null;
}

export const DEFAULT_PLATFORM_NAME = "COVVA";

export function buildDisclosure(p: DisclosureParties): string {
  const platform = p.platform ?? DEFAULT_PLATFORM_NAME;
  const broker = `${p.broker.name}${p.broker.licence ? `, NIC licence ${p.broker.licence}` : ""}`;
  const parts = [
    `Technology provided by ${platform}.`,
    `Insurance broking services provided by ${broker}.`,
  ];
  parts.push(p.insurer ? `This policy is underwritten and issued by ${p.insurer.name}.` : "The policy will be underwritten and issued by the insurer you choose.");
  return parts.join(" ");
}

/** Short role statements used across the marketing site and apps. */
export const ROLE_STATEMENTS = {
  platform: "We provide the technology. We are not an insurer or broker, we do not give insurance advice and we never hold your premium.",
  broker: "Your named broker of record advises you, arranges your cover and helps with renewals, complaints and claims.",
  insurer: "Licensed insurers approve products and prices, accept the risk, issue policies and decide and pay claims.",
  payment: "Payments go through an authorised payment provider directly to the insurer.",
} as const;

export const CLAIM_DISCLAIMER =
  "Your broker helps you submit this. The insurer assesses coverage and decides the claim. Reporting a claim does not mean approval.";

export const DEMO_DISCLAIMER = "Illustrative only. Insurers shown are not partners. Demo data.";
