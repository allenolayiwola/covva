import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Camera } from "lucide-react";
import { CLAIM_DISCLAIMER } from "@im/core";
import { EmptyState, Notice, PageHeader, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { proxyClaimEligibility } from "@/server/diaspora";
import { CATEGORY_COLS, ORG_COLS, UUID_RE, account, policyTitle, type CategoryLite, type OrgLite } from "../../../_lib/data";
import { DEFAULT_INCIDENTS, INCIDENT_TYPES } from "../../../_lib/labels";
import { ProxyClaimForm, type ProxyClaimPolicy } from "./proxy-claim-form";

export const metadata: Metadata = { title: "File a claim for a family member" };

export default function ProxyClaimPage({ searchParams }: PageProps<"/account/family/claims/new">) {
  return (
    <div className="max-w-xl">
      <Breadcrumbs items={[{ label: "Family", href: "/account/family" }, { label: "File a claim" }]} />
      <PageHeader title="File a claim for a family member" description="You report it on their behalf; the broker checks the evidence and the insurer decides." />
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/account/family/claims/new">, "searchParams">) {
  const sp = await searchParams;
  const { user, supabase } = await account("/account/family/claims/new");
  const { data } = await supabase
    .from("policies")
    .select(`id, nickname, summary, policy_number, internal_reference, status, beneficiary_id, category:product_categories(${CATEGORY_COLS}), insurer:organizations!policies_insurer_org_id_fkey(${ORG_COLS})`)
    .eq("sponsor_user_id", user.id)
    .not("beneficiary_id", "is", null)
    .in("status", ["active", "expired", "lapsed", "renewed"])
    .order("cover_end", { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as unknown as { id: string; nickname: string | null; summary: string | null; policy_number: string | null; internal_reference: string; status: string; beneficiary_id: string | null; category: CategoryLite | null; insurer: OrgLite | null }[];
  if (!rows.length) {
    return (
      <EmptyState
        icon={<Camera className="size-5" />}
        title="No family policies to claim on"
        body="Claims by proxy are made on active policies you pay for through a sponsorship. Once a family member's policy is issued it appears here."
        action={<Link href="/account/family" className={buttonClass("secondary")}>Back to family</Link>}
      />
    );
  }
  const beneficiaryIds = [...new Set(rows.map((r) => r.beneficiary_id).filter((x): x is string => !!x))];
  const { data: beneficiaries } = await supabase.from("beneficiaries").select("id, full_name").in("id", beneficiaryIds);
  const names = new Map((beneficiaries ?? []).map((b) => [b.id, b.full_name]));
  const policies: ProxyClaimPolicy[] = [];
  for (const p of rows) {
    const elig = await proxyClaimEligibility(supabase, user.id, p.id);
    policies.push({
      id: p.id,
      label: `${policyTitle(p)}${p.status !== "active" ? ` (${p.status.replace(/_/g, " ")})` : ""}`,
      subtitle: [names.get(p.beneficiary_id ?? "") ? `for ${names.get(p.beneficiary_id ?? "")}` : null, p.category?.name, p.insurer?.name, p.policy_number ?? p.internal_reference].filter(Boolean).join(" · "),
      beneficiaryId: p.beneficiary_id ?? "",
      beneficiaryName: names.get(p.beneficiary_id ?? "") ?? "your family member",
      incidents: INCIDENT_TYPES[p.category?.slug ?? ""] ?? DEFAULT_INCIDENTS,
      eligible: elig.check.ok,
      blockedReason: elig.check.ok ? null : elig.check.message,
    });
  }
  const preselect = typeof sp.policy === "string" && UUID_RE.test(sp.policy) ? sp.policy : policies.length === 1 ? policies[0]!.id : undefined;
  return (
    <>
      <Notice tone="info" className="mb-5">{CLAIM_DISCLAIMER}</Notice>
      <ProxyClaimForm userId={user.id} policies={policies} initialPolicyId={preselect} />
    </>
  );
}
