import { PAYMENTS_DISCLOSURE } from "@/components/marketing/payments-disclosure";
import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/catalog";
import { getBrand } from "@/components/marketing/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms that apply when you use the Covva website and apps. Draft — subject to legal review.",
  alternates: { canonical: "/legal/terms" },
};

export default async function TermsPage() {
  const [brand, version] = await Promise.all([getBrand(), getSetting<string>("terms_version")]);
  const n = brand.name;

  return (
    <LegalPage
      current="/legal/terms"
      title="Terms of use"
      version={version}
      summary={<>These terms explain what {n} does and does not do, and the rules for using our website and apps. Please read them with our <Link href="/legal/privacy" className="font-medium text-brand hover:underline">privacy notice</Link> and <Link href="/legal/disclosures" className="font-medium text-brand hover:underline">disclosures</Link>.</>}
      sections={[
        {
          id: "who-we-are",
          title: "Who we are",
          body: (
            <>
              <p>
                {n} (“we”, “us”) is the brand name of a technology platform whose operating company, Ghanaian company registration number and registered office address are to be confirmed before launch.
              </p>
              <p>
                We provide technology that helps you explore, compare and manage insurance. <strong>We are not an insurer and not an insurance broker.</strong> We do not give insurance advice in our own name, we do not underwrite risks, we do not decide claims. {PAYMENTS_DISCLOSURE}
              </p>
            </>
          ),
        },
        {
          id: "roles",
          title: "Who does what",
          body: (
            <>
              <ul>
                <li><strong>Your broker of record</strong> — a broker licensed by the National Insurance Commission (NIC) — advises you, arranges your cover and helps with renewals, complaints and claims. We tell you who your broker is, with their licence number, before any advice or application.</li>
                <li><strong>The insurer</strong> — licensed under the Insurance Act, 2021 (Act 1061) — approves products and prices, accepts the risk, issues your policy, and decides and pays claims.</li>
                <li><strong>The payment provider</strong> — an authorised payment service provider — processes your payment directly to the insurer.</li>
              </ul>
              <p>Your contract of insurance is with the insurer. Your broking relationship is with your broker. These terms govern your use of our platform only.</p>
            </>
          ),
        },
        {
          id: "using",
          title: "Using the platform",
          body: (
            <>
              <p>You must be at least 18 years old and able to enter into contracts under Ghanaian law to request quotes or apply for cover. You agree to:</p>
              <ul>
                <li>give true, complete and up-to-date information, including in declarations to insurers — inaccurate information can mean an insurer refuses a claim or cancels a policy;</li>
                <li>keep your sign-in details secure and tell us promptly if you think your account has been used without permission;</li>
                <li>use the platform only for lawful purposes and not to submit the same risk repeatedly or on behalf of others without their authority;</li>
                <li>not interfere with, scrape, reverse-engineer or attempt to gain unauthorised access to our systems.</li>
              </ul>
            </>
          ),
        },
        {
          id: "comparison",
          title: "Comparisons, quotes and guidance",
          body: (
            <>
              <p>
                We compare products from <strong>participating insurers only</strong>, not the whole market. Each comparison states how many insurers and products were included.
              </p>
              <p>Quotes are shown with one of three states:</p>
              <ul>
                <li><strong>Estimate</strong> — an indicative price from approved rates. It is not an offer and cannot be applied for.</li>
                <li><strong>Awaiting underwriting</strong> — the insurer is reviewing your details and the price may change.</li>
                <li><strong>Ready to accept</strong> — a binding offer from the insurer that you may apply for until its validity date.</li>
              </ul>
              <p>
                Quotes are revalidated at checkout. Tools such as “Help me choose” provide general information, not personal advice or a recommendation of any product. Your broker advises on your circumstances. Content labelled as AI-assisted is generated to explain or summarise and is reviewable by a person; it never decides suitability or claims.
              </p>
            </>
          ),
        },
        {
          id: "payment",
          title: "Payment and when cover starts",
          body: (
            <>
              <p>{PAYMENTS_DISCLOSURE}</p>
              <p>
                <strong>Payment confirmation alone does not make a policy active.</strong> Cover starts only when the insurer confirms acceptance and issues your policy. Until then your request shows as awaiting insurer issuance. If the insurer declines, any premium paid is refunded in line with the insurer’s and payment provider’s procedures.
              </p>
            </>
          ),
        },
        {
          id: "documents",
          title: "Documents, claims and renewals",
          body: (
            <>
              <p>
                Policy documents in your wallet are issued by the insurer. Uploading a document to us does not mean the insurer has received it until we show that delivery is confirmed.
              </p>
              <p>
                Reporting a claim through the platform does not mean it has been approved. The insurer assesses and decides every claim under the policy terms. We send renewal reminders, but it remains your responsibility to make sure you are covered.
              </p>
            </>
          ),
        },
        {
          id: "fees",
          title: "Fees",
          body: <p>Using the platform as a customer is free. {PAYMENTS_DISCLOSURE} See our <Link href="/legal/disclosures">disclosures</Link>.</p>,
        },
        {
          id: "ip",
          title: "Intellectual property",
          body: <p>The platform, its design and content (excluding insurer and broker materials) belong to us or our licensors. You may use them for your personal, non-commercial use of the service only.</p>,
        },
        {
          id: "liability",
          title: "Our responsibility to you",
          body: (
            <>
              <p>
                We take reasonable care to make the platform accurate and available, but we cannot guarantee it will always be uninterrupted or error-free. Product information comes from insurers and is shown as approved by them; the policy wording issued by the insurer prevails.
              </p>
              <p>
                We are not responsible for advice given by brokers, or for underwriting, policy or claims decisions made by insurers. Nothing in these terms limits any liability that cannot be limited under Ghanaian law, including under consumer protection legislation.
              </p>
            </>
          ),
        },
        {
          id: "closing",
          title: "Suspending or closing accounts",
          body: <p>You can close your account at any time. We may suspend or close an account if we reasonably believe it is being used fraudulently or in breach of these terms. Policies already issued by insurers are not affected by closing your account.</p>,
        },
        {
          id: "changes",
          title: "Changes to these terms",
          body: <p>We may update these terms. If changes are significant, we will tell you in the app or by email before they take effect and ask you to accept them where required.</p>,
        },
        {
          id: "law",
          title: "Complaints, governing law and contact",
          body: (
            <>
              <p>
                If you are unhappy, please follow our <Link href="/legal/complaints">complaints procedure</Link>. These terms are governed by the laws of the Republic of Ghana and the courts of Ghana have jurisdiction.
              </p>
              <p>Contact: <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a> · Additional contact details are to be confirmed before launch.</p>
            </>
          ),
        },
      ]}
    />
  );
}
