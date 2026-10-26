import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Field, Input, Notice, Select, Textarea } from "@im/ui";
import { ISSUANCE_TYPES, formatDate, formatDateTime, humanize } from "@im/core";
import { can, ROLES } from "../../../../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { VersionHeader } from "@/components/partner/version-nav";
import { loadVersionPage } from "../../../_lib";
import { schedulePriceChange, setIssuance, submitForCompliance } from "../../../catalogue-actions";

export const metadata: Metadata = { title: "Product version" };

export default function VersionPage({ params }: PageProps<"/partner/products/[id]/versions/[versionId]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Version params={params} />
    </Suspense>
  );
}

const ISSUANCE_LABEL: Record<string, string> = { instant: "Instant (delegated / API issuance)", within_hours: "Issued within X hours (insurer issues on an SLA)", manual: "Manual (insurer or broker issues after review)" };

async function Version({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const { ctx, product, version, riskFields } = await loadVersionPage(id, versionId);
  const editable = can(ctx, ROLES.underwrite);
  const isCurrent = product.current_version_id === version.id;
  const [{ count: tables }, { count: rules }, { count: templates }] = await Promise.all([
    ctx.supabase.from("rate_tables").select("id", { count: "exact", head: true }).eq("product_version_id", version.id),
    ctx.supabase.from("underwriting_rules").select("id", { count: "exact", head: true }).eq("product_version_id", version.id).eq("active", true),
    ctx.supabase.from("document_templates").select("id", { count: "exact", head: true }).eq("product_version_id", version.id),
  ]);
  const rating = (version.rating ?? {}) as { model?: string; rate_table_id?: string };
  const minSchedule = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 16);

  return (
    <>
      <VersionHeader product={product} version={version} active="overview" isCurrent={isCurrent} />

      {version.compliance_status === "returned" && (
        <Notice tone="danger" title="Returned by Covva compliance" className="mb-5">{version.compliance_notes ?? "See the notes from the compliance team, fix the version and resubmit."}</Notice>
      )}
      {version.compliance_status === "published" && version.compliance_notes && <Notice tone="ok" className="mb-5">Compliance note: {version.compliance_notes}</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="At a glance">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Effective</dt><dd className="font-medium text-ink">{formatDate(version.effective_from)}{version.effective_to ? ` – ${formatDate(version.effective_to)}` : ""}</dd></div>
            <div><dt className="text-muted">Pricing model</dt><dd className="font-medium text-ink">{rating.model ? humanize(rating.model) : "—"}{rating.model === "rate_table" && !rating.rate_table_id ? " (no table linked)" : ""}</dd></div>
            <div><dt className="text-muted">Rate tables</dt><dd className="font-medium text-ink">{tables ?? 0}</dd></div>
            <div><dt className="text-muted">Active underwriting rules</dt><dd className="font-medium text-ink">{rules ?? 0}</dd></div>
            <div><dt className="text-muted">Document templates</dt><dd className="font-medium text-ink">{templates ?? 0}</dd></div>
            <div><dt className="text-muted">Submitted</dt><dd className="font-medium text-ink">{formatDateTime(version.insurer_approved_at ?? version.created_at)}</dd></div>
            {version.change_summary && <div className="sm:col-span-2"><dt className="text-muted">Change summary</dt><dd className="text-ink">{version.change_summary}</dd></div>}
            {version.supersedes_version_id && <div className="sm:col-span-2"><dt className="text-muted">Supersedes</dt><dd className="text-ink">an earlier version (existing quotes and policies keep theirs)</dd></div>}
          </dl>
        </Section>

        <Section title="Issuance type and SLA" description="Shown to customers on every quote for this version, before they pay.">
          {editable ? (
            <ActionForm action={setIssuance} submitLabel="Save issuance" className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="versionId" value={version.id} />
              <Field label="Issuance type" htmlFor="it" className="sm:col-span-2">
                <Select id="it" name="issuanceType" defaultValue={version.issuance_type} className="h-10 text-sm">
                  {ISSUANCE_TYPES.map((t) => <option key={t} value={t}>{ISSUANCE_LABEL[t]}</option>)}
                </Select>
              </Field>
              <Field label="SLA (hours)" htmlFor="sla" hint="For “within hours”: how long after payment the policy is issued. Leave blank for 24.">
                <Input id="sla" name="slaHours" type="number" min={0} max={720} defaultValue={version.sla_hours ?? ""} className="h-10 text-sm" />
              </Field>
            </ActionForm>
          ) : (
            <p className="text-sm text-ink">{ISSUANCE_LABEL[version.issuance_type]}{version.sla_hours ? ` · ${version.sla_hours} hours` : ""}</p>
          )}
        </Section>

        <Section title="Compliance review" description="Draft → Submitted → Covva compliance review → Published. Covva can return a submission with comments.">
          {version.status === "draft" && editable ? (
            <ActionForm action={submitForCompliance} submitLabel="Submit for compliance review" confirm="Submit this version to Covva compliance? You confirm the wording and rates are approved by your organisation.">
              <input type="hidden" name="versionId" value={version.id} />
              <Field label="What changed (for the reviewer)" htmlFor="cs"><Textarea id="cs" name="changeSummary" rows={3} defaultValue={version.change_summary ?? ""} placeholder="New rate table for private motor; SLA set to 24 hours." /></Field>
              {rating.model === "rate_table" && (tables ?? 0) === 0 && <Notice tone="wait">This version prices from a rate table but has none. Add one under “Rate tables” first.</Notice>}
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">
              {version.compliance_status === "published" ? "Published and in use for new quotes." : version.status === "pending_approval" ? "Submitted. Covva compliance is reviewing this version." : `Status: ${humanize(version.compliance_status)}.`}
            </p>
          )}
        </Section>

        <Section title="Schedule a price change" description="Creates a new draft version (cloned from this one) that goes live automatically at the chosen time once Covva publishes it. Existing quotes and policies keep this version.">
          {editable ? (
            <ActionForm action={schedulePriceChange} submitLabel="Create scheduled version" className="space-y-3">
              <input type="hidden" name="versionId" value={version.id} />
              <Field label="Goes live at" htmlFor="eff"><Input id="eff" name="effectiveAt" type="datetime-local" min={minSchedule} required className="h-10 text-sm" /></Field>
              <Field label="Change summary" htmlFor="chs"><Input id="chs" name="changeSummary" required placeholder="5% increase on commercial vehicles from 1 January" className="h-10 text-sm" /></Field>
              <Field label="New rating rule (JSON, optional)" htmlFor="rt" hint={`Leave blank to copy the current rule. Risk fields: ${riskFields.map((f) => f.key).join(", ") || "—"}`}>
                <Textarea id="rt" name="rating" rows={5} className="font-mono text-xs" placeholder={JSON.stringify(version.rating)} />
              </Field>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Underwriters and admins can schedule price changes.</p>
          )}
        </Section>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
