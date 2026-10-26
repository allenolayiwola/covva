import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Checkbox, Notice, PageHeader, Pill } from "@im/ui";
import type { RatingRule, RiskField } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, personName, profileMap } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumb, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { VersionDiff } from "../../VersionDiff";
import { TestPricePanel } from "../../TestPricePanel";
import { PRODUCT_TONE } from "../../meta";
import { approveVersion, rejectVersion } from "../../actions";

export default function ReviewVersionPage({ params }: PageProps<"/products/review/[versionId]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading version…" />}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: Pick<PageProps<"/products/review/[versionId]">, "params">) {
  const staff = await requireStaff();
  const { versionId } = await params;
  if (!isUuid(versionId)) notFound();
  const supabase = await createClient();
  const { data: v } = await supabase.from("product_versions").select("*").eq("id", versionId).maybeSingle();
  if (!v) notFound();
  const { data: product } = await supabase.from("products").select("*").eq("id", v.product_id).single();
  if (!product) notFound();
  const [{ data: current }, { data: insurer }, { data: category }] = await Promise.all([
    product.current_version_id && product.current_version_id !== v.id
      ? supabase.from("product_versions").select("*").eq("id", product.current_version_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("organizations").select("id, name").eq("id", product.insurer_org_id).single(),
    supabase.from("product_categories").select("name, risk_schema").eq("id", product.category_id).single(),
  ]);
  const people = await profileMap(supabase, [v.submitted_by, v.approved_by]);
  const canAct = can(staff.roles, "productApproval");
  const pending = v.status === "pending_approval";
  const fields = (Array.isArray(category?.risk_schema) ? category.risk_schema : []) as unknown as RiskField[];

  return (
    <>
      <Breadcrumb items={[{ label: "Products", href: "/products?view=queue" }, { label: product.name, href: `/products/${product.id}` }, { label: `v${v.version}` }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{product.name} v{v.version} <Pill tone={PRODUCT_TONE[v.status]}>{v.status.replace("_", " ")}</Pill></span>}
        description={`${insurer?.name ?? ""} · ${category?.name ?? ""} · submitted ${formatDateTime(v.created_at)}${v.submitted_by ? ` by ${personName(people.get(v.submitted_by))}` : ""}`}
        actions={
          pending ? (
            <>
              <ConfirmAction
                action={rejectVersion}
                fields={{ versionId: v.id }}
                label="Reject"
                title="Return version to the insurer"
                confirmLabel="Reject version"
                reasonLabel="What needs to change (sent to the submitter)"
                disabled={!canAct}
              />
              <ConfirmAction
                action={approveVersion}
                fields={{ versionId: v.id }}
                label="Approve"
                title={`Approve ${product.name} v${v.version}`}
                triggerVariant="primary"
                variant="primary"
                confirmLabel="Approve and make current"
                requireReason={false}
                disabled={!canAct}
                body="Customers will see this version's coverage, limits, excesses, exclusions and rates immediately. The previous version is end-dated and kept for existing policies."
              >
                {!v.insurer_approved_at && (
                  <Checkbox name="insurerConfirmed" label="The insurer has not recorded sign-off in the portal. I confirm we hold the insurer's written approval of this wording and rating." />
                )}
              </ConfirmAction>
            </>
          ) : null
        }
      />
      <ReadOnlyBanner show={!canAct} />
      {!pending && <Notice tone="info" className="mb-5">This version is {v.status.replace("_", " ")}{v.approved_at ? ` — approved ${formatDateTime(v.approved_at)} by ${personName(people.get(v.approved_by ?? ""), "staff")}` : ""}.</Notice>}
      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        <Pill tone={v.insurer_approved_at ? "ok" : "wait"}>{v.insurer_approved_at ? `Insurer signed off ${formatDate(v.insurer_approved_at)}` : "No insurer sign-off recorded"}</Pill>
        {v.wording_url ? <Link href={v.wording_url} target="_blank" className="rounded-full bg-info-bg px-2.5 py-0.5 font-medium text-info">Open policy wording ↗</Link> : <Pill tone="wait">No wording document</Pill>}
      </div>
      <div className="space-y-6">
        <Panel title={current ? `Changes vs current v${current.version}` : "New product — no current version"} description="Red = current value, green = proposed value." bodyClassName="p-0">
          <VersionDiff current={current} proposed={v} />
        </Panel>
        <Panel title="Test pricing" description="Run the rating engine for current and proposed rules on sample risks from the category's risk schema.">
          <TestPricePanel fields={fields} current={(current?.rating as unknown as RatingRule) ?? null} proposed={(v.rating as unknown as RatingRule) ?? null} />
        </Panel>
      </div>
    </>
  );
}
