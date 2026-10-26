import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge, Notice, Pill, Table, Td, Th, THead } from "@im/ui";
import { formatDate, formatDateTime, humanize, issuanceLabel, type RiskField } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getCategoryMap } from "../../../_lib/data";
import { VersionEditor, type VersionDraft } from "@/components/partner/version-editor";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { submitVersion } from "../actions";

export const metadata: Metadata = { title: "Product" };

export default function ProductPage({ params }: PageProps<"/partner/products/[id]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Product params={params} />
    </Suspense>
  );
}

const DEFAULT_RATING = { model: "rate_on_value", value_fields: ["sum_insured"], rate: 0.01, min_premium: 200, loadings: [] };

async function Product({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKind("insurer");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: product } = await ctx.supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!product || product.insurer_org_id !== ctx.orgId) notFound();
  const [{ data: versions }, cats] = await Promise.all([
    ctx.supabase.from("product_versions").select("*").eq("product_id", id).order("version", { ascending: false }),
    getCategoryMap(),
  ]);
  const category = cats.get(product.category_id);
  const current = (versions ?? []).find((v) => v.id === product.current_version_id);
  const base = current ?? (versions ?? [])[0];
  const pending = (versions ?? []).filter((v) => v.status === "pending_approval");

  const toRows = (o: unknown) => Object.entries((o ?? {}) as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? "") }));
  const initial: VersionDraft = {
    coverage: ((base?.coverage ?? []) as unknown as VersionDraft["coverage"]).map((c) => ({ key: c.key, label: c.label, included: !!c.included, detail: c.detail ?? "" })),
    limits: toRows(base?.limits),
    excesses: toRows(base?.excesses),
    exclusions: (base?.exclusions ?? []).join("\n"),
    keyExclusion: base?.key_exclusion ?? "",
    waitingPeriodDays: base?.waiting_period_days ?? 0,
    optionalBenefits: ((base?.optional_benefits ?? []) as unknown as { key: string; label: string; premium?: number }[]).map((b) => ({ key: b.key, label: b.label, premium: b.premium != null ? String(b.premium) : "" })),
    conditions: base?.conditions ?? "",
    claimsProcess: base?.claims_process ?? "",
    rating: JSON.stringify(base?.rating && Object.keys(base.rating as object).length ? base.rating : DEFAULT_RATING, null, 2),
    effectiveFrom: new Date().toISOString().slice(0, 10),
    wordingUrl: base?.wording_url ?? "",
  };
  if (initial.coverage.length === 0) initial.coverage = [{ key: "", label: "", included: true }];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/products" className="hover:text-brand">Products</Link> <span aria-hidden>›</span> {product.name}
      </nav>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{product.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {product.code} · {category?.name} {product.tier ? `· ${product.tier}` : ""}
          <Pill tone={product.status === "approved" ? "ok" : "wait"}>{humanize(product.status)}</Pill>
        </p>
      </div>

      <Section title="Versions" description="The current version is the approved one used for quoting and comparison.">
        {(versions ?? []).length === 0 ? <p className="text-sm text-muted">No versions yet.</p> : (
          <Table>
            <THead><tr><Th>Version</Th><Th>Status</Th><Th>Compliance</Th><Th>Effective</Th><Th>Issuance</Th><Th>Submitted</Th><Th>Approved</Th><Th /></tr></THead>
            <tbody>
              {(versions ?? []).map((v) => (
                <tr key={v.id}>
                  <Td className="font-semibold text-ink">v{v.version} {v.id === product.current_version_id && <Pill tone="ok" className="ml-1">Current</Pill>}</Td>
                  <Td><Pill tone={v.status === "approved" ? "ok" : v.status === "pending_approval" ? "wait" : "neutral"}>{humanize(v.status)}</Pill></Td>
                  <Td><Pill tone={v.compliance_status === "published" ? "ok" : v.compliance_status === "returned" ? "danger" : v.compliance_status === "draft" ? "neutral" : "wait"}>{humanize(v.compliance_status)}</Pill></Td>
                  <Td>{formatDate(v.effective_from)}{v.effective_to ? ` – ${formatDate(v.effective_to)}` : ""}{v.scheduled_effective_from && v.id !== product.current_version_id ? <span className="block text-xs text-muted">scheduled {formatDateTime(v.scheduled_effective_from)}</span> : null}</Td>
                  <Td className="text-xs">{issuanceLabel(v.issuance_type, v.sla_hours)}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(v.insurer_approved_at ?? v.created_at)}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(v.approved_at)}</Td>
                  <Td><Link href={`/partner/products/${product.id}/versions/${v.id}`} className="text-sm font-semibold text-brand hover:underline">Rates, rules &amp; templates →</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {can(ctx, ROLES.underwrite) ? (
        <Section className="mt-6" title="Create a new version" description={base ? `Pre-filled from v${base.version}. Edit what changes; everything is versioned.` : "Describe the cover and the approved rating rule."}>
          {pending.length > 0 && <Notice tone="wait" className="mb-4">v{pending.map((v) => v.version).join(", v")} is already awaiting platform approval. A new submission will be reviewed separately.</Notice>}
          <VersionEditor action={submitVersion} productId={product.id} initial={initial} riskSchema={(category?.risk_schema ?? []) as unknown as RiskField[]} />
        </Section>
      ) : (
        <p className="mt-6 text-sm text-muted">Underwriters and admins can submit new versions.</p>
      )}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
