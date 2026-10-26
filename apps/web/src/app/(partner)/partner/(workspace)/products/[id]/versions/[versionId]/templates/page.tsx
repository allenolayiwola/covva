import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Pill } from "@im/ui";
import { formatDateTime, type StructuredTemplate, type TemplateKind } from "@im/core";
import { can, ROLES } from "../../../../../../_lib/context";
import { TemplateEditor } from "@/components/partner/template-editor";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { VersionHeader } from "@/components/partner/version-nav";
import { loadVersionPage } from "../../../../_lib";
import { saveTemplate } from "../../../../catalogue-actions";

export const metadata: Metadata = { title: "Document templates" };

export default function TemplatesPage({ params }: PageProps<"/partner/products/[id]/versions/[versionId]/templates">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Templates params={params} />
    </Suspense>
  );
}

async function Templates({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const { ctx, product, version } = await loadVersionPage(id, versionId);
  const editable = can(ctx, ROLES.underwrite);
  const { data: templates } = await ctx.supabase.from("document_templates").select("*").eq("product_version_id", version.id).order("kind").order("version", { ascending: false });

  return (
    <>
      <VersionHeader product={product} version={version} active="templates" isCurrent={product.current_version_id === version.id} />
      <p className="mb-5 text-sm text-muted">Templates for the schedule, certificate, sticker and receipt issued on this product. Covva approves a template before it is used; editing an approved template creates a new draft version.</p>

      <div className="space-y-6">
        {(templates ?? []).length === 0 && <Section title="No templates yet"><p className="text-sm text-muted">Create the first one below — each kind starts from a sensible default.</p></Section>}
        {(templates ?? []).map((t) => (
          <Section
            key={t.id}
            title={<span className="flex flex-wrap items-center gap-2">{t.name} <Pill tone="neutral">{t.kind}</Pill><Pill tone={t.status === "approved" ? "ok" : "wait"}>{t.status === "approved" ? `Approved ${formatDateTime(t.approved_at)}` : "Draft — awaiting Covva approval"}</Pill><span className="text-xs text-muted">template v{t.version}</span></span>}
          >
            {editable ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand">{t.status === "approved" ? "View / edit as new draft" : "Edit"}</summary>
                <div className="mt-3">
                  <TemplateEditor action={saveTemplate} versionId={version.id} templateId={t.id} kind={t.kind as TemplateKind} name={t.name} template={t.template as unknown as StructuredTemplate} />
                </div>
              </details>
            ) : (
              <p className="text-sm text-muted">Underwriters and admins can edit templates.</p>
            )}
          </Section>
        ))}
      </div>

      {editable && (
        <Section className="mt-6" title="New template">
          <TemplateEditor action={saveTemplate} versionId={version.id} />
        </Section>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
