import type { Metadata } from "next";
import { DisclosureBlock } from "@im/ui";
import { ROLE_STATEMENTS, buildDisclosure } from "@im/core";
import { getBrand } from "@/components/marketing/brand";
import { LegalPage } from "@/components/marketing/legal-page";
import { REGULATION } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "Disclosures",
  description: "Our role, how we and brokers are paid, how comparisons work, and conflicts of interest. Draft — subject to legal review.",
  alternates: { canonical: "/legal/disclosures" },
};

export default async function DisclosuresPage() {
  const brand = await getBrand();
  const sample = buildDisclosure({ platform: brand.name, broker: { name: "[Broker name]", licence: "[licence number]" }, insurer: { name: "[Insurer name]" } });

  return (
    <LegalPage
      current="/legal/disclosures"
      title="Disclosures"
      summary={<>Plain statements about our role, how everyone involved is paid, and how we keep comparisons fair.</>}
      sections={[
        {
          id: "role",
          title: "Our role",
          body: (
            <>
              <p>{ROLE_STATEMENTS.platform}</p>
              <p>
                We operate as a technology provider in partnership with brokers licensed by the National Insurance Commission. Our regulatory classification is being confirmed with the NIC, and this page will be updated when it is.
              </p>
            </>
          ),
        },
        {
          id: "transaction",
          title: "The transaction disclosure",
          body: (
            <>
              <p>Before any advice or application, and on every quote, checkout and policy screen, we show who is responsible for your cover:</p>
              <DisclosureBlock text={sample} />
              <p>Your broker of record is named with their NIC licence number before advice is given. If your broker changes, we ask for your consent first.</p>
            </>
          ),
        },
        {
          id: "pay",
          title: "How we and brokers are paid",
          body: (
            <ul>
              <li><strong>Customers</strong> pay nothing to use the platform. You pay the premium set by the insurer.</li>
              <li><strong>Brokers</strong> are paid commission by insurers, within limits set by the NIC. You can ask your broker for the amount of commission on your policy.</li>
              <li><strong>{brand.name}</strong> is paid technology fees by participating brokers and insurers (subscription and usage fees). Our fees do not depend on which insurer you choose.</li>
              <li>We never hold your premium. Payments settle directly to the insurer through an authorised payment provider.</li>
            </ul>
          ),
        },
        {
          id: "comparison",
          title: "How comparisons work",
          body: (
            <ul>
              <li>We compare participating insurers only. Each comparison shows the number of insurers and products included — we never claim to cover the whole market.</li>
              <li>Default ordering is stated on screen (for example “Sorted by price”). Labels such as “Lowest price” mean exactly that; we do not label any product “best”.</li>
              <li>Paid placements, if ever introduced, will be clearly labelled and excluded from rankings.</li>
              <li>Every quote is time-stamped, shows its state (estimate, awaiting underwriting, ready to accept) and is revalidated before payment.</li>
              <li>Recommendations from our guidance tools record the inputs, products considered and reasons, so they can be reviewed.</li>
            </ul>
          ),
        },
        {
          id: "conflicts",
          title: "Conflicts of interest",
          body: <p>We maintain a conflicts of interest policy. Staff and partners must declare relevant interests. No insurer or broker can pay to change how products are ranked. Where a conflict cannot be avoided, we will tell you about it.</p>,
        },
        {
          id: "demo",
          title: "Demonstration content",
          body: <p>Until live insurer agreements are in place, some insurer and broker names, prices and policies shown on the site are fictional and labelled “Illustrative only · Demo data”. They are not real offers.</p>,
        },
        {
          id: "law",
          title: "Applicable law",
          body: <p>Insurance in Ghana is regulated by the {REGULATION.nic.name} under the {REGULATION.act1061}. Personal data is processed under the {REGULATION.act843}.</p>,
        },
      ]}
    />
  );
}
