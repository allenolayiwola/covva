import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Field, Input, Notice, Pill } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { can, ROLES } from "../../../../../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { CsvImportForm, RateRowsEditor, TemplateDownload, type EditableRow } from "@/components/partner/rate-table-editor";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { VersionHeader } from "@/components/partner/version-nav";
import { loadVersionPage } from "../../../../_lib";
import { createRateTable, importRateTableCsv, saveRateRows, submitRateTable, useRateTableForPricing } from "../../../../catalogue-actions";

export const metadata: Metadata = { title: "Rate tables" };

export default function RatesPage({ params }: PageProps<"/partner/products/[id]/versions/[versionId]/rates">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Rates params={params} />
    </Suspense>
  );
}

const tone = (s: string) => (s === "approved" ? "ok" : s === "pending_review" ? "wait" : s === "rejected" ? "danger" : "neutral") as "ok" | "wait" | "danger" | "neutral";

async function Rates({ params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const { ctx, product, version, riskFields } = await loadVersionPage(id, versionId);
  const editable = can(ctx, ROLES.underwrite);
  const { data: tables } = await ctx.supabase.from("rate_tables").select("*").eq("product_version_id", version.id).order("created_at", { ascending: false });
  const tableIds = (tables ?? []).map((t) => t.id);
  const { data: rows } = tableIds.length ? await ctx.supabase.from("rate_rows").select("id, rate_table_id, factors, rate, rate_kind, min_premium").in("rate_table_id", tableIds).order("created_at") : { data: [] };
  const rating = (version.rating ?? {}) as { model?: string; rate_table_id?: string };
  const defaultKeys = riskFields.filter((f) => f.type === "select" || f.type === "region").map((f) => f.key).slice(0, 3);
  const valueFieldHint = riskFields.filter((f) => f.type === "currency").map((f) => f.key).join(", ");

  return (
    <>
      <VersionHeader product={product} version={version} active="rates" isCurrent={product.current_version_id === version.id} />
      <p className="mb-5 text-sm text-muted">
        Rate tables are first-class data: factor keys (e.g. vehicle use, age band, region) × rows with a rate. Link a table to this version’s pricing and Covva reviews it before it is used for live quotes.
      </p>

      {(tables ?? []).length === 0 && <Notice tone="info" className="mb-5">No rate tables yet. Create one and add rows by hand, or upload a CSV using the template.</Notice>}

      <div className="space-y-6">
        {(tables ?? []).map((t) => {
          const tRows = (rows ?? []).filter((r) => r.rate_table_id === t.id);
          const initial: EditableRow[] = tRows.map((r) => ({
            id: r.id,
            factors: Object.fromEntries((t.factor_keys ?? []).map((k) => [k, String(((r.factors ?? {}) as Record<string, unknown>)[k] ?? "*")])),
            rate: String(r.rate),
            rate_kind: r.rate_kind as EditableRow["rate_kind"],
            min_premium: r.min_premium == null ? "" : String(r.min_premium),
          }));
          const linked = rating.model === "rate_table" && rating.rate_table_id === t.id;
          const locked = !editable || t.status === "approved";
          return (
            <Section
              key={t.id}
              title={<span className="flex flex-wrap items-center gap-2">{t.name} <Pill tone={tone(t.status)}>{humanize(t.status)}</Pill>{linked && <Pill tone="info">Used for pricing</Pill>}</span>}
              description={`${(t.factor_keys ?? []).join(" × ") || "no factors"} · ${tRows.length} row${tRows.length === 1 ? "" : "s"} · ${t.source} · created ${formatDateTime(t.created_at)}${t.review_notes ? ` · review note: ${t.review_notes}` : ""}`}
              actions={<TemplateDownload factorKeys={t.factor_keys ?? []} name={`${t.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-template.csv`} />}
            >
              <RateRowsEditor action={saveRateRows} tableId={t.id} factorKeys={t.factor_keys ?? []} initial={initial} locked={locked} />
              {editable && (
                <div className="mt-4 flex flex-wrap items-start gap-4 border-t border-line pt-4">
                  {t.status === "draft" && tRows.length > 0 && (
                    <ActionForm action={submitRateTable} submitLabel="Submit for Covva review" variant="secondary" inline>
                      <input type="hidden" name="tableId" value={t.id} />
                    </ActionForm>
                  )}
                  {!linked && version.status === "draft" && (
                    <ActionForm action={useRateTableForPricing} submitLabel="Use this table for pricing" variant="secondary" inline>
                      <input type="hidden" name="tableId" value={t.id} />
                      <Input name="valueFields" placeholder={`value fields (default sum_insured)${valueFieldHint ? ` e.g. ${valueFieldHint}` : ""}`} className="h-9 w-72 text-sm" aria-label="Value fields" />
                      <Input name="minPremium" type="number" min={0} placeholder="min premium" className="h-9 w-32 text-sm" aria-label="Minimum premium" />
                    </ActionForm>
                  )}
                  {!linked && version.status !== "draft" && <p className="text-xs text-muted">Pricing of a {humanize(version.status).toLowerCase()} version cannot be changed — schedule a price change to create a draft.</p>}
                </div>
              )}
            </Section>
          );
        })}
      </div>

      {editable && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Section title="New rate table (manual)" description="Then add rows in the editor above.">
            <ActionForm action={createRateTable} submitLabel="Create table" className="grid gap-3">
              <input type="hidden" name="versionId" value={version.id} />
              <Field label="Name" htmlFor="rt-name"><Input id="rt-name" name="name" required placeholder="Private motor rates 2027" className="h-10 text-sm" /></Field>
              <Field label="Factor keys" htmlFor="rt-keys" hint={`Comma-separated risk fields. Available: ${riskFields.map((f) => f.key).join(", ") || "—"}`}>
                <Input id="rt-keys" name="factorKeys" required defaultValue={defaultKeys.join(", ")} className="h-10 text-sm" />
              </Field>
            </ActionForm>
          </Section>
          <Section title="Upload a CSV" description="Validated before import; errors show the row number. Each import creates a new table.">
            <CsvImportForm action={importRateTableCsv} versionId={version.id} defaultFactorKeys={defaultKeys} />
          </Section>
        </div>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
