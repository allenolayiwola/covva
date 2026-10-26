import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Megaphone } from "lucide-react";
import { COMPLAINT_STATUS, formatDate } from "@im/core";
import { EmptyState, PageHeader, StatusPill, buttonClass } from "@im/ui";
import { ListSkeleton } from "@/components/customer/skeletons";
import { account } from "../_lib/data";
import { COMPLAINT_CATEGORY_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Complaints" };

export default function ComplaintsPage() {
  return (
    <>
      <PageHeader
        title="Complaints"
        description="Something not right? Tell us. Firms aim to resolve complaints within 14 days, and you can escalate to the National Insurance Commission."
        actions={<Link href="/account/complaints/new" className={buttonClass("primary")}>Make a complaint</Link>}
      />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  const { user, supabase } = await account("/account/complaints");
  const { data } = await supabase
    .from("complaints")
    .select("id, reference, subject, category, status, against_party, due_at, created_at")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });
  if (!data?.length) {
    return (
      <EmptyState
        icon={<Megaphone className="size-5" />}
        title="No complaints"
        body="We hope it stays that way. If something goes wrong with your broker, insurer or this platform, you can complain here."
      />
    );
  }
  return (
    <ul className="divide-y divide-line rounded-card border border-line">
      {data.map((c) => (
        <li key={c.id}>
          <Link href={`/account/complaints/${c.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-mist/50">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{c.subject}</p>
              <p className="truncate text-sm text-muted">
                {c.reference} · {COMPLAINT_CATEGORY_LABEL[c.category] ?? c.category} · About your {c.against_party} · Filed {formatDate(c.created_at)}
              </p>
            </div>
            <StatusPill meta={COMPLAINT_STATUS[c.status]} />
            <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
