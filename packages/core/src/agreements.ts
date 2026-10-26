/**
 * Partner agreement texts (Addendum 3 B1/C1/E) signed in-app during registration.
 *
 * E-signature model (no external provider yet): the applicant types their name and title,
 * ticks an explicit consent box, and we record the timestamp, IP, user agent and the SHA-256
 * hash of the exact agreement text version they saw. `provider` is reserved for DocuSign later.
 *
 * Plain-language text. Bump `version` whenever the wording changes: the hash of the old
 * version stays valid for applications signed under it.
 */
export type PartnerAgreementKind = "insurer" | "broker";

export interface PartnerAgreement {
  version: string;
  title: string;
  /** Ordered sections; each is rendered as a heading + paragraphs. */
  sections: { heading: string; body: string }[];
}

const COMMON_INTRO =
  "Covva is a licensed insurance marketplace and technology platform. Covva is not an insurer and not a broker: it never holds premiums, never issues cover and never decides claims. This agreement sets out how your organisation works with Covva.";

export const PARTNER_AGREEMENT_V1: Record<PartnerAgreementKind, PartnerAgreement> = {
  insurer: {
    version: "insurer-v1",
    title: "Covva Insurer Partner Agreement (v1)",
    sections: [
      { heading: "1. Who we are", body: COMMON_INTRO },
      {
        heading: "2. Your licence",
        body: "You confirm that your organisation holds a valid National Insurance Commission (NIC) licence of the class you declared and that the licence details, documents and contacts in your application are true and complete. You will tell Covva within 5 working days if your licence is suspended, restricted or not renewed. Covva verifies your licence against the NIC register before you go live and suspends your organisation automatically if the licence lapses.",
      },
      {
        heading: "3. Products and pricing",
        body: "You own your products, rates, rules, wordings and documents on Covva. Every product and every price change goes through Covva's compliance review before it is published, and existing quotes and policies keep the version they were sold under. You are responsible for the accuracy of what you publish and for NIC approval of your wordings.",
      },
      {
        heading: "4. Quotes, issuance and claims",
        body: "Only you bind cover and issue policy documents, within the service levels you agree per product line. Claims are decided by you alone; Covva and brokers only help customers report and track them. You will respond to broker submissions, issuance requests and claims within the agreed service levels; missed service levels are shown to the customer and escalated.",
      },
      {
        heading: "5. Brokers",
        body: "Brokers reach your products only through appointments you approve per product line in your Covva portal (or that Covva verifies from an appointment letter). You may decline or revoke an appointment at any time; a revocation removes the broker's eligibility for new orders immediately.",
      },
      {
        heading: "6. Payments and settlement",
        body: "Customer premiums are collected by a licensed payment provider and split at source to the settlement account you register. Covva's platform fee and any broker commission are deducted as shown on each settlement statement. Covva never holds client money.",
      },
      {
        heading: "7. Data protection",
        body: "You will use customer data shared through Covva only to quote, issue and service the policy and handle claims, in line with the Data Protection Act, 2012 (Act 843). You will keep it secure, not sell or share it, and delete or return it when it is no longer needed. Each party is a separate data controller for its own processing.",
      },
      {
        heading: "8. Fees, term and ending the agreement",
        body: "Commercial terms are recorded on your organisation in Covva and may only be changed in writing. Either party may end this agreement with 60 days' written notice; policies already sold continue to be serviced. Covva may suspend access immediately for a lapsed licence, a regulatory direction, fraud or a serious breach.",
      },
      {
        heading: "9. Signing",
        body: "By typing your name and ticking the consent box you confirm that you are authorised to sign for your organisation and that this electronic signature is as binding as a handwritten one under the Electronic Transactions Act, 2008 (Act 772).",
      },
    ],
  },
  broker: {
    version: "broker-v1",
    title: "Covva Broker Partner Agreement (v1)",
    sections: [
      { heading: "1. Who we are", body: COMMON_INTRO },
      {
        heading: "2. Your licence and conduct",
        body: "You confirm that your organisation holds a valid NIC broker licence, that your principal officer is fit and proper, and that the details, documents and contacts in your application are true and complete. You will tell Covva within 5 working days if your licence is suspended, restricted or not renewed. Covva verifies your licence against the NIC register before you go live and suspends your organisation automatically if the licence lapses.",
      },
      {
        heading: "3. Advice and customer care",
        body: "You are the broker of record for every customer routed to you. You will give suitable advice, disclose that you are a broker, keep customers informed at every step, meet the service levels shown in your workspace, and handle complaints promptly. Only the insurer binds cover and decides claims; you will never promise either.",
      },
      {
        heading: "4. Insurer appointments",
        body: "You may only place business with insurers that have appointed you for that product line. On Covva an appointment is either approved by the insurer in its portal or verified by Covva from your appointment letter. You will not place a risk outside an active appointment.",
      },
      {
        heading: "5. Commission and the commercial model",
        body: "You choose either the revenue-share model (Covva keeps a share of your commission on Covva-sourced business) or a subscription plan. The rate or plan is recorded on your organisation in Covva and shown on every settlement statement. Clients you bring onto Covva remain yours for renewals and servicing, and no revenue share applies to business you sourced yourself.",
      },
      {
        heading: "6. Payments",
        body: "Premiums are paid by customers to the insurer through a licensed payment provider and split at source; you never collect premiums through Covva. Your commission is settled to the account you register.",
      },
      {
        heading: "7. Data protection",
        body: "You will use customer data shared through Covva only to advise, place and service the customer's insurance, in line with the Data Protection Act, 2012 (Act 843). You will keep it secure, not sell or share it, and obtain the customer's consent before onboarding existing clients onto Covva.",
      },
      {
        heading: "8. Term and ending the agreement",
        body: "Either party may end this agreement with 60 days' written notice; customers you serve continue to be serviced until they are reassigned. Covva may suspend access immediately for a lapsed licence, a regulatory direction, fraud or a serious breach.",
      },
      {
        heading: "9. Signing",
        body: "By typing your name and ticking the consent box you confirm that you are authorised to sign for your organisation and that this electronic signature is as binding as a handwritten one under the Electronic Transactions Act, 2008 (Act 772).",
      },
    ],
  },
};

/** Canonical plain text of an agreement (what gets hashed and what the applicant sees). */
export function agreementText(agreement: PartnerAgreement): string {
  return [agreement.title, "", ...agreement.sections.flatMap((s) => [s.heading, s.body, ""])].join("\n").trimEnd();
}

/** SHA-256 (hex) of the agreement text. Works in Node ≥ 20 and browsers (Web Crypto). */
export async function agreementHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The agreement an applicant of this kind signs today. */
export function currentAgreement(kind: PartnerAgreementKind): PartnerAgreement {
  return PARTNER_AGREEMENT_V1[kind];
}
