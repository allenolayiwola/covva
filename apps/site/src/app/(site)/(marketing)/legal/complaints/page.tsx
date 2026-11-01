import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/catalog";
import { getBrand } from "@/components/marketing/brand";
import { LegalPage } from "@/components/marketing/legal-page";
import { REGULATION } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "Complaints procedure",
  description: "How to complain about a broker, an insurer or our platform, how we handle it, and how to escalate to the National Insurance Commission. Draft — subject to legal review.",
  alternates: { canonical: "/legal/complaints" },
};

export default async function ComplaintsPage() {
  const [brand, slaDays] = await Promise.all([getBrand(), getSetting<number>("complaint_sla_days")]);
  const days = typeof slaDays === "number" ? slaDays : 14;

  return (
    <LegalPage
      current="/legal/complaints"
      title="Complaints procedure"
      summary={<>If something has gone wrong, we want to put it right. This procedure explains how to complain, who handles what, how long it takes, and how to escalate to the regulator.</>}
      sections={[
        {
          id: "how",
          title: "How to complain",
          body: (
            <>
              <p>You can complain in whichever way is easiest for you:</p>
              <ul>
                <li>from your account — open the request or policy and choose “Raise a complaint”;</li>
                <li>by email to <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>;</li>
                <li>through our <Link href="/contact">contact form</Link>;</li>
                <li>by phone or in writing, using contact details to be confirmed before launch.</li>
              </ul>
              <p>Please tell us your name, how to contact you, the request or policy reference (if any), what happened and what you would like us to do. You can ask someone to complain on your behalf with your written permission.</p>
            </>
          ),
        },
        {
          id: "who",
          title: "Who handles your complaint",
          body: (
            <>
              <p>We record every complaint and route it to the party responsible:</p>
              <ul>
                <li><strong>Your broker of record</strong> — advice, quotes, the information given to you, and help with claims.</li>
                <li><strong>The insurer</strong> — underwriting decisions, policy terms, claim decisions and payments. Your broker helps you raise these.</li>
                <li><strong>{brand.name}</strong> — the website and apps, our customer service, data protection and how information was displayed.</li>
              </ul>
              <p>If a complaint involves more than one party, we coordinate so that you do not have to explain it twice, and we tell you who is dealing with each part.</p>
            </>
          ),
        },
        {
          id: "timeline",
          title: "What happens and when",
          body: (
            <ol>
              <li><strong>Acknowledgement</strong> — within a number of working days to be confirmed before launch, with a reference number and the name of the person handling it.</li>
              <li><strong>Investigation</strong> — we, your broker or the insurer review what happened, including records and messages. We may ask you for more information.</li>
              <li><strong>Final response</strong> — we aim to resolve complaints within {days} days. If we need longer, we will tell you why and when to expect an answer.</li>
              <li><strong>If you are not satisfied</strong> — our final response explains how to escalate, including to the National Insurance Commission.</li>
            </ol>
          ),
        },
        {
          id: "nic",
          title: "Escalating to the National Insurance Commission",
          body: (
            <>
              <p>
                If your complaint about a broker or insurer is not resolved to your satisfaction, or you have not received a final response within the time above, you can refer it to the Complaints Bureau of the {REGULATION.nic.name}.
              </p>
              <p>
                Website: <a href={REGULATION.nic.url} target="_blank" rel="noreferrer">nic.gov.gh</a>. Additional contact details are to be confirmed before launch.
              </p>
              <p>Complaints about how we handle personal data can also be raised with the <a href={REGULATION.dpc.url} target="_blank" rel="noreferrer">{REGULATION.dpc.name}</a>.</p>
            </>
          ),
        },
        {
          id: "fair",
          title: "Our commitments",
          body: (
            <ul>
              <li>Making a complaint is free and will never affect how your request or claim is treated.</li>
              <li>We will be clear, keep you updated and explain decisions in plain language.</li>
              <li>We review complaint trends regularly to fix root causes, and report them to our risk & compliance committee.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
