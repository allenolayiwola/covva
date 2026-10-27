import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, buttonClass } from "@im/ui";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account } from "../../_lib/data";
import { CreateBusinessForm } from "./create-form";

export const metadata: Metadata = { title: "Create a business account" };

export default function NewBusinessPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Create a business account"
        description="Set up your business once: invite colleagues, upload staff and vehicles, request group, fleet, property and liability quotes and pay a single consolidated statement."
        actions={<Link href="/account/business" className={buttonClass("outline", "sm")}>Back</Link>}
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Gate />
      </Suspense>
    </div>
  );
}

async function Gate() {
  await account("/account/business/new");
  return (
    <Card className="p-5 sm:p-6">
      <CreateBusinessForm />
    </Card>
  );
}
