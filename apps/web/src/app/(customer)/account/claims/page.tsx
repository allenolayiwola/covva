import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Camera, ChevronRight } from "lucide-react";
import { CLAIM_DISCLAIMER, CLAIM_STATUS, formatDate, formatGHS, humanize } from "@im/core";
import { EmptyState, Notice, PageHeader, StatusPill, buttonClass } from "@im/ui";
import { CategoryIcon } from "@/components/customer/category-icon";
import { ListSkeleton } from "@/components/customer/skeletons";
import { account } from "../_lib/data";

export const metadata: Metadata = { title: "Claims" };

export default function ClaimsPage() {
  return (
    <>
      <PageHeader
        title="Claims"
        description="Report what happened, add evidence and follow the insurer's decision."
        actions={<Link href="/account/claims/new" className={buttonClass("primary")}><Camera aria-hidden className="size-4" /> Report a claim</Link>}
      />
      <Notice tone="neutral" className="mb-6">{CLAIM_DISCLAIMER}</Notice>
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <ClaimList />
      </Suspense>
    </>
  );
}

async function ClaimList() {
  const { user, supabase } = await account("/account/claims");
  const { data } = await supabase
    .from("claims")
    .select("id, reference, status, incident_type, incident_at, amount_claimed, created_at, policy:policies(id, nickname, policy_number, internal_reference, category:product_categories(name, icon)), insurer:organizations!claims_insurer_org_id_fkey(name)")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });
  const claims = (data ?? []) as unknown as {
    id: string;
    reference: string;
    status: keyof typeof CLAIM_STATUS;
    incident_type: string;
    incident_at: string | null;
    amount_claimed: number | null;
    created_at: string;
    policy: { id: string; nickname: string | null; policy_number: string | null; internal_reference: string; category: { name: string; icon: string | null } | null } | null;
    insurer: { name: string } | null;
  }[];
  if (!claims.length) {
    return (
      <EmptyState
        icon={<Camera className="size-5" />}
        title="No claims"
        body="If something happens, report it here as soon as you can. Your broker helps you submit it to the insurer."
      />
    );
  }
  return (
    <ul className="divide-y divide-line rounded-card border border-line">
      {claims.map((c) => (
        <li key={c.id}>
          <Link href={`/account/claims/${c.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-mist/50">
            <CategoryIcon icon={c.policy?.category?.icon} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">
                {humanize(c.incident_type)} <span className="font-normal text-muted">· {c.policy?.nickname ?? c.policy?.category?.name}</span>
              </p>
              <p className="truncate text-sm text-muted">
                {c.reference} · {c.insurer?.name} · {c.incident_at ? `Happened ${formatDate(c.incident_at)}` : `Reported ${formatDate(c.created_at)}`}
                {c.amount_claimed ? ` · ${formatGHS(Number(c.amount_claimed))}` : ""}
              </p>
            </div>
            <StatusPill meta={CLAIM_STATUS[c.status]} />
            <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
