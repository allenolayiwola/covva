import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Notice, Pill } from "@im/ui";
import { humanize, type UnderwritingRule } from "@im/core";
import { can, ROLES } from "../../../../../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { RuleForm } from "@/components/partner/rules-editor";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { VersionHeader } from "@/components/partner/version-nav";
import { toUnderwritingRule } from "@/server/catalogue";
import { loadVersionPage } from "../../../../_lib";
import { saveRule, toggleRule } from "../../../../catalogue-actions";

export const metadata: Metadata = { title: "Underwriting rules" };

export default function RulesPage({ params }: PageProps<"/partner/products/[id]/versions/[versionId]/rules">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Rules params={params} />
    </Suspense>
  );
}

const tone = (o: string) => (o === "accept" ? "ok" : o === "refer" ? "wait" : "danger") as "ok" | "wait" | "danger";

function describe(r: UnderwritingRule): string {
  const c = r.condition;
  if (c && "field" in c) {
    const v = Array.isArray(c.value) ? c.value.join(", ") : c.value === undefined ? "" : String(c.value);
    return `${c.field.replace(/_/g, " ")} ${c.op.replace(/_/g, " ")} ${v}`.trim();
  }
  return "compound condition";
}

async function Rules({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const { ctx, product, version, riskFields } = await loadVersionPage(id, versionId);
  const editable = can(ctx, ROLES.underwrite);
  const { data } = await ctx.supabase.from("underwriting_rules").select("*").eq("product_version_id", version.id).order("priority").order("created_at");
  const rules = (data ?? []).map(toUnderwritingRule);

  return (
    <>
      <VersionHeader product={product} version={version} active="rules" isCurrent={product.current_version_id === version.id} />
      <p className="mb-5 text-sm text-muted">
        Each rule tests one risk field. <strong>Accept</strong> lets the quote through, <strong>refer</strong> sends it to your underwriters (L1 review) and <strong>decline</strong> hides the product for that risk. A risk only fits delegated (instant / within-hours) issuance when no rule refers or declines it.
      </p>
      {version.issuance_type === "manual" && <Notice tone="info" className="mb-5">This version is issued manually, so rules only steer broker quotes. Set the issuance type to instant or within-hours on the overview to enable delegated issuance checks.</Notice>}

      <Section title={`Rules (${rules.length})`}>
        {rules.length === 0 ? <p className="text-sm text-muted">No rules yet — every risk is accepted.</p> : (
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Pill tone={tone(r.outcome)}>{r.outcome}</Pill>
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="text-muted">— {describe(r)}</span>
                    {r.active === false && <Pill tone="neutral">Inactive</Pill>}
                    <span className="text-xs text-subtle">priority {r.priority ?? 100}</span>
                  </div>
                  {editable && (
                    <ActionForm action={toggleRule} submitLabel={r.active === false ? "Enable" : "Disable"} variant="ghost" inline>
                      <input type="hidden" name="ruleId" value={r.id} />
                      <input type="hidden" name="active" value={r.active === false ? "true" : "false"} />
                    </ActionForm>
                  )}
                </div>
                {r.message && <p className="mt-1 text-sm text-ink-2">{r.message}</p>}
                {editable && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer font-medium text-brand">Edit</summary>
                    <div className="mt-2"><RuleForm action={saveRule} versionId={version.id} fields={riskFields} rule={r} compact /></div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editable && (
        <Section className="mt-6" title="Add a rule" description={`Fields come from the ${humanize(version.status).toLowerCase()} version's category risk schema.`}>
          <RuleForm action={saveRule} versionId={version.id} fields={riskFields} />
        </Section>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
