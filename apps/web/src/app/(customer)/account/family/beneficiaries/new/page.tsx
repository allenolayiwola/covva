import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account } from "../../../_lib/data";
import { BeneficiaryForm } from "./beneficiary-form";

export const metadata: Metadata = { title: "Add a family member" };

export default function NewBeneficiaryPage() {
  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Family", href: "/account/family" }, { label: "Add a family member" }]} />
      <PageHeader title="Add a family member" description="Someone in Ghana you want to arrange cover for. They confirm with a code we send to their phone — nothing is shared with a broker or insurer until they agree." />
      <Notice tone="info" className="mb-6" title="Their consent comes first">
        We text (or WhatsApp) them a 6-digit code and a link. They read the code to you or tap the link to accept. Only then can you request quotes for them.
      </Notice>
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await account("/account/family/beneficiaries/new");
  return <BeneficiaryForm />;
}
