import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge, Notice, Pill } from "@im/ui";
import { describeProductChange, formatDate, formatDateTime, groupHistoryByDay, productStatusLabel, type ProductHistoryRow } from "@im/core";
import { requireKind } from "../../../../_lib/context";
import { PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Product history" };

/**
 * Per-product change history (Roadmap Phase 1), built from the existing audit rows through
 * `product_change_history`: the product, its versions, rate tables, underwriting rules, document templates
 * and bulk actions, each turned into one plain line. Any member of the insurer can read it.
 */
export default function HistoryPage({ params }: PageProps<"/partner/products/[id]/history">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <History params={params} />
    </Suspense>
  );
}

async function History({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKind("insurer");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: product } = await ctx.supabase.from("products").select("id, name, code, status, current_version_id").eq("id", id).maybeSingle();
  if (!product || product.id !== id) notFound();
  const [{ data: rows, error }, { data: versions }] = await Promise.all([
    ctx.supabase.rpc("product_change_history", { p_product_id: id, p_limit: 300 }),
    ctx.supabase.from("product_versions").select("id, version, status, compliance_status, effective_from, effective_to, approved_at, created_at").eq("product_id", id).order("version", { ascending: false }),
  ]);
  const lines = ((rows ?? []) as ProductHistoryRow[]).map(describeProductChange);
  const days = groupHistoryByDay(lines);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/products" className="hover:text-brand">Products</Link> <span aria-hidden>›</span>{" "}
        <Link href={`/partner/products/${product.id}`} className="hover:text-brand">{product.name}</Link> <span aria-hidden>›</span> History
      </nav>
      <div className="mb-6">
        <h1 className="flex flex-wrap items-center gap-2 text-[28px] font-bold leading-tight tracking-tight text-ink">
          {product.name} <span className="text-muted">history</span>
          <Pill tone={product.status === "approved" ? "ok" : product.status === "suspended" ? "wait" : product.status === "retired" ? "danger" : "neutral"}>{productStatusLabel(product.status)}</Pill>
        </h1>
        <p className="mt-1 text-sm text-muted">{product.code} · every change to the product, its versions, rate tables, rules and templates, newest first. Written by the database audit log; it cannot be edited.</p>
      </div>

      {error && <Notice tone="danger" className="mb-5">{error.message}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Section title="Timeline">
          {days.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-6">
              {days.map((d) => (
                <li key={d.day}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{formatDate(d.day)}</h3>
                  <ol className="divide-y divide-line rounded-card border border-line">
                    {d.lines.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{formatDateTime(l.at).split(",").pop()?.trim().slice(0, 5)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <Pill tone={l.tone}>{l.scope}</Pill>
                            <span className="font-medium text-ink">{l.title}</span>
                          </span>
                          {l.details.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-muted">
                              {l.details.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
                              {l.details.length > 8 && <li>…and {l.details.length - 8} more fields</li>}
                            </ul>
                          )}
                          <span className="mt-1 block text-xs text-subtle">by {l.actor}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Versions" description="Every version is kept; existing quotes and policies keep theirs.">
          {(versions ?? []).length === 0 ? (
            <p className="text-sm text-muted">No versions yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.id} className="rounded-card border border-line px-3 py-2">
                  <Link href={`/partner/products/${product.id}/versions/${v.id}`} className="flex flex-wrap items-center gap-2 font-medium text-ink hover:text-brand">
                    v{v.version}
                    {v.id === product.current_version_id && <Pill tone="ok">Current</Pill>}
                    <Pill tone={v.compliance_status === "published" ? "ok" : v.compliance_status === "returned" ? "danger" : v.compliance_status === "draft" ? "neutral" : "wait"}>{v.compliance_status.replace(/_/g, " ")}</Pill>
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    Effective {formatDate(v.effective_from)}{v.effective_to ? ` – ${formatDate(v.effective_to)}` : ""} · created {formatDate(v.created_at)}{v.approved_at ? ` · published ${formatDate(v.approved_at)}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
