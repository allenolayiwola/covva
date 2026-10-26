import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader } from "@im/ui";
import { getCategories, getPartnerDirectory } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account } from "../../_lib/data";
import { ExternalPolicyForm } from "./form";

export const metadata: Metadata = { title: "Add a policy" };

export default function NewExternalPolicyPage() {
  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "My policies", href: "/account/policies" }, { label: "Add a policy" }]} />
      <PageHeader title="Add a policy bought elsewhere" description="Keep all your cover in one wallet, with reminders before it ends." />
      <Notice tone="info" className="mb-6">
        We&apos;ll show this policy as “Added by you”. We don&apos;t check it with the insurer, and adding it doesn&apos;t change your cover.
      </Notice>
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const { user } = await account("/account/policies/new");
  const [categories, { insurers }] = await Promise.all([getCategories(), getPartnerDirectory()]);
  return (
    <ExternalPolicyForm
      userId={user.id}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      insurers={insurers.map((i) => ({ id: i.id, name: i.name }))}
    />
  );
}
