import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Camera } from "lucide-react";
import { EmptyState, buttonClass } from "@im/ui";
import { PageSkeleton } from "@/components/customer/skeletons";
import { CATEGORY_COLS, ORG_COLS, UUID_RE, account, policyTitle, type CategoryLite, type OrgLite } from "../../_lib/data";
import { DEFAULT_INCIDENTS, INCIDENT_TYPES } from "../../_lib/labels";
import { ClaimForm, type ClaimPolicy } from "./claim-form";
import { T } from "@/lib/i18n/client";

export const metadata: Metadata = { title: "Report a claim" };

export default function NewClaimPage({ searchParams }: PageProps<"/account/claims/new">) {
  return (
    <div className="max-w-xl">
      <p className="mb-1 text-sm font-medium text-muted"><T k="claim.report" /></p>
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/account/claims/new">, "searchParams">) {
  const sp = await searchParams;
  const { user, supabase } = await account("/account/claims/new");
  const { data } = await supabase
    .from("policies")
    .select(`id, nickname, summary, policy_number, internal_reference, status, category:product_categories(${CATEGORY_COLS}), insurer:organizations!policies_insurer_org_id_fkey(${ORG_COLS})`)
    .eq("customer_id", user.id)
    .in("status", ["active", "expired", "lapsed", "renewed", "pending_issuance"])
    .order("cover_end", { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as unknown as {
    id: string;
    nickname: string | null;
    summary: string | null;
    policy_number: string | null;
    internal_reference: string;
    status: string;
    category: CategoryLite | null;
    insurer: OrgLite | null;
  }[];

  if (!rows.length) {
    return (
      <EmptyState
        icon={<Camera className="size-5" />}
        title="No policies to claim on"
        body="Claims are made against a policy in your wallet. If your policy was bought elsewhere, add it first — or contact your insurer directly."
        action={<Link href="/account/policies/new" className={buttonClass("primary")}>Add a policy</Link>}
      />
    );
  }

  const policies: ClaimPolicy[] = rows.map((p) => ({
    id: p.id,
    label: `${policyTitle(p)}${p.status !== "active" ? ` (${p.status.replace(/_/g, " ")})` : ""}`,
    subtitle: [p.category?.name, p.insurer?.name, p.policy_number ?? p.internal_reference].filter(Boolean).join(" · "),
    categorySlug: p.category?.slug ?? "",
    incidents: INCIDENT_TYPES[p.category?.slug ?? ""] ?? DEFAULT_INCIDENTS,
  }));
  const preselect = typeof sp.policy === "string" && UUID_RE.test(sp.policy) ? sp.policy : rows.length === 1 ? rows[0]!.id : undefined;
  return <ClaimForm userId={user.id} policies={policies} initialPolicyId={preselect} />;
}
