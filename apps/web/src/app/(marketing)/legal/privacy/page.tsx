import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/catalog";
import { getBrand } from "@/components/marketing/brand";
import { LegalPage } from "@/components/marketing/legal-page";
import { REGULATION } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How Insurance Marketplace collects, uses, shares and protects personal data under Ghana’s Data Protection Act, 2012 (Act 843). Draft — subject to legal review.",
  alternates: { canonical: "/legal/privacy" },
};

export default async function PrivacyPage() {
  const [brand, version] = await Promise.all([getBrand(), getSetting<string>("privacy_version")]);
  const n = brand.name;

  return (
    <LegalPage
      current="/legal/privacy"
      title="Privacy notice"
      version={version}
      summary={<>We collect only what is needed to arrange and service your insurance, share it only with the people involved in doing that, and never sell it. This notice explains the detail and your rights under the {REGULATION.act843}.</>}
      sections={[
        {
          id: "controller",
          title: "Who is responsible for your data",
          body: (
            <>
              <p>
                [Legal entity name], operating as {n}, is the data controller for personal data processed through our website and apps. We intend to be registered with the {REGULATION.dpc.name} as required by Act 843 [registration number to be confirmed].
              </p>
              <p>
                Your broker of record and the insurers you ask for quotes are separate controllers for the data they receive to advise you, underwrite your risk and administer your policy. Their own privacy notices also apply.
              </p>
              <p>Data protection contact: [Data Protection Supervisor name], <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.</p>
            </>
          ),
        },
        {
          id: "collect",
          title: "What we collect",
          body: (
            <ul>
              <li><strong>Identity and contact details</strong> — name, phone number, email, date of birth, Ghana Card or passport details where an insurer requires them.</li>
              <li><strong>Risk information</strong> — details about what you want to insure, for example your vehicle, home, trip, business or the people to be covered.</li>
              <li><strong>Special category data</strong> — health information only where needed for health, life or travel cover, collected with your explicit consent.</li>
              <li><strong>Documents</strong> — photos and documents you upload, such as vehicle registration or claim evidence.</li>
              <li><strong>Transaction data</strong> — quotes, applications, payment references and status (we do not store full card numbers or mobile money PINs).</li>
              <li><strong>Communications</strong> — messages with your broker and our support team.</li>
              <li><strong>Technical data</strong> — device, browser, IP address and usage information to keep the service secure and working.</li>
            </ul>
          ),
        },
        {
          id: "use",
          title: "How we use it and why",
          body: (
            <>
              <ul>
                <li>To create and secure your account, and verify your identity — <em>to perform our contract with you</em>.</li>
                <li>To route your request to a licensed broker, obtain quotes and arrange cover — <em>contract, and your consent where special category data is involved</em>.</li>
                <li>To send service messages such as status updates, renewal reminders and claim progress — <em>contract and legitimate interests</em>.</li>
                <li>To prevent fraud and duplicate submissions, and keep an audit trail — <em>legal obligation and legitimate interests</em>.</li>
                <li>To improve the platform using aggregated or de-identified data — <em>legitimate interests</em>.</li>
                <li>To send marketing, only if you opt in — <em>consent, which you can withdraw at any time</em>.</li>
              </ul>
              <p>
                We use automated tools, including AI, to explain, summarise and extract information for review by people. We do not make decisions about suitability or claims by automated means alone.
              </p>
            </>
          ),
        },
        {
          id: "share",
          title: "Who we share it with",
          body: (
            <>
              <ul>
                <li>Your <strong>broker of record</strong>, to advise you and arrange and service your cover.</li>
                <li>The <strong>insurers</strong> your broker approaches for your request — only what they need to quote and underwrite.</li>
                <li>The <strong>payment provider</strong>, to process your payment to the insurer.</li>
                <li>Service providers who host and operate our systems (for example cloud hosting, messaging and email), under contracts requiring confidentiality and security.</li>
                <li>Regulators, law enforcement or courts, where the law requires it.</li>
              </ul>
              <p><strong>We do not sell your personal data.</strong> We never submit the same risk to the same insurer twice.</p>
            </>
          ),
        },
        {
          id: "transfers",
          title: "International transfers",
          body: <p>Some of our service providers may store or process data outside Ghana. Where they do, we put safeguards in place as required by Act 843, such as contractual commitments and security controls. [List of hosting regions to be confirmed.]</p>,
        },
        {
          id: "retention",
          title: "How long we keep it",
          body: <p>We keep personal data only as long as needed for the purposes above and to meet legal, regulatory and insurer record-keeping requirements — generally [six] years after your last policy ends or your request closes, unless a longer period is required by law or for an ongoing claim or complaint. Unsubmitted drafts are deleted after [90] days.</p>,
        },
        {
          id: "rights",
          title: "Your rights",
          body: (
            <>
              <p>Under Act 843 you have the right to:</p>
              <ul>
                <li>be told what personal data we hold about you and receive a copy;</li>
                <li>ask us to correct inaccurate or incomplete data;</li>
                <li>ask us to delete data or stop processing it, subject to legal retention rules;</li>
                <li>object to processing for direct marketing at any time;</li>
                <li>withdraw consent where we rely on it;</li>
                <li>complain to the <a href={REGULATION.dpc.url} target="_blank" rel="noreferrer">{REGULATION.dpc.name}</a>.</li>
              </ul>
              <p>To exercise your rights, use the privacy settings in your account or email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>. We will respond within [21] days.</p>
            </>
          ),
        },
        {
          id: "security",
          title: "How we protect it",
          body: <p>We use encryption in transit and at rest, role-based and organisation-scoped access controls, multi-factor authentication for staff, and a tamper-evident audit trail of access to customer records. We test our controls regularly and will notify you and the Data Protection Commission of a breach where required.</p>,
        },
        {
          id: "cookies",
          title: "Cookies",
          body: <p>See our <Link href="/legal/cookies">cookie notice</Link>.</p>,
        },
        {
          id: "changes",
          title: "Changes to this notice",
          body: <p>We will update this notice when our practices change and show the version at the top. If changes are significant, we will tell you before they take effect.</p>,
        },
      ]}
    />
  );
}
