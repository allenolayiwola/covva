import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoBadge, Field, Notice, Pill, StatusPill, Table, Td, Textarea, Th, THead } from "@im/ui";
import { QUOTE_STATUS, formatDate, formatDateTime, formatGHS, humanize, type RiskField } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getCategoryMap, getCustomers, getOrgNames, requestKind, shortName } from "../../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { QuoteForm, type VersionOption } from "@/components/partner/quote-form";
import { riskDisplay } from "@/components/partner/risk-fields";
import { DueCell, Empty, KV, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { acknowledgeSubmission, declineSubmission, respondWithQuote } from "../actions";

export const metadata: Metadata = { title: "Submission" };

export default function SubmissionPage({ params }: PageProps<"/partner/submissions/[id]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Submission params={params} />
    </Suspense>
  );
}

async function Submission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKind("insurer");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = ctx.supabase;

  const { data: sub } = await sb.from("insurer_submissions").select("*").eq("id", id).maybeSingle();
  if (!sub || sub.insurer_org_id !== ctx.orgId) notFound();
  // Insurers can read the request because a submission exists (RLS: can_access_request).
  const { data: req } = await sb.from("requests").select("id, reference, type, category_id, customer_id, risk_data, created_at, source").eq("id", sub.request_id).maybeSingle();
  if (!req) notFound();

  const [cats, customers, brokers, { data: quotes }, { data: docs }, { data: products }] = await Promise.all([
    getCategoryMap(),
    getCustomers(ctx, [req.customer_id]),
    getOrgNames(ctx, [sub.broker_org_id]),
    sb.from("quotes").select("*").eq("request_id", req.id).eq("insurer_org_id", ctx.orgId).order("created_at", { ascending: false }),
    sb.from("documents").select("id, file_name, kind, storage_path, delivered_to_insurer_at, created_at").eq("request_id", req.id).not("delivered_to_insurer_at", "is", null),
    sb.from("products").select("id, name, status, version:product_versions!products_current_version_fk(id, version, status, rating, excesses, key_exclusion)").eq("insurer_org_id", ctx.orgId).eq("category_id", req.category_id),
  ]);
  const signed = (docs ?? []).length ? await sb.storage.from("documents").createSignedUrls((docs ?? []).map((d) => d.storage_path), 600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const category = cats.get(req.category_id);
  const schema = (category?.risk_schema ?? []) as unknown as RiskField[];
  const risk = (req.risk_data ?? {}) as Record<string, unknown>;
  const versions: VersionOption[] = ((products ?? []) as unknown as { id: string; name: string; version: { id: string; version: number; status: string; rating: unknown; excesses: Record<string, unknown>; key_exclusion: string | null } | null }[])
    .filter((p) => p.version)
    .map((p) => ({ id: p.version!.id, insurerId: ctx.orgId, label: `${p.name} · v${p.version!.version}${p.version!.status !== "approved" ? ` (${humanize(p.version!.status)})` : ""}`, rating: p.version!.rating, excesses: p.version!.excesses ?? {}, keyExclusion: p.version!.key_exclusion }));
  const open = (quotes ?? []).find((q) => ["estimate", "awaiting_underwriting", "ready_to_accept"].includes(q.status));
  const closed = ["declined", "withdrawn", "error"].includes(sub.status);
  const canAct = can(ctx, ROLES.underwrite) && !closed;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/submissions" className="hover:text-brand">Submissions</Link> <span aria-hidden>›</span> {req.reference}
      </nav>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{req.reference} · {requestKind(category?.name, req.type)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {sub.broker_org_id ? `From ${brokers.get(sub.broker_org_id) ?? "broker"} (broker of record)` : "Direct order — issued directly by the insurer, no broker of record"} · {humanize(sub.channel)} · received {formatDateTime(sub.created_at)}
            <Pill tone={sub.status === "quoted" ? "ok" : closed ? "danger" : "wait"}>{humanize(sub.status)}</Pill>
          </p>
        </div>
        <div className="rounded-card border border-line bg-white p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted">Response due</p>
          {sub.responded_at ? <p className="font-semibold text-ink">Answered {formatDateTime(sub.responded_at)}</p> : <DueCell dueAt={sub.response_due_at} />}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Section title="Risk details" description={`Customer: ${shortName(customers.get(req.customer_id))} · ${category?.name ?? ""}`}>
            {schema.map((f) => <KV key={f.key} label={f.label}>{riskDisplay(f, risk[f.key])}</KV>)}
            {Object.keys(risk).filter((k) => !schema.some((f) => f.key === k)).map((k) => <KV key={k} label={humanize(k)}>{String(risk[k])}</KV>)}
            {schema.length === 0 && Object.keys(risk).length === 0 && <Empty>No structured risk data. Ask the broker for details.</Empty>}
          </Section>

          <Section title="Your quotes on this risk">
            {(quotes ?? []).length === 0 ? <Empty>No quote yet.</Empty> : (
              <Table>
                <THead><tr><Th>Status</Th><Th>Premium</Th><Th>Excess</Th><Th>Sum insured</Th><Th>Valid until</Th><Th>Updated</Th></tr></THead>
                <tbody>
                  {(quotes ?? []).map((q) => (
                    <tr key={q.id}>
                      <Td><StatusPill meta={QUOTE_STATUS[q.status]} /></Td>
                      <Td className="tabular-nums">{formatGHS(Number(q.premium))}</Td>
                      <Td className="tabular-nums">{formatGHS(q.excess != null ? Number(q.excess) : null)}</Td>
                      <Td className="tabular-nums">{formatGHS(q.sum_insured != null ? Number(q.sum_insured) : null)}</Td>
                      <Td>{formatDate(q.valid_until)}</Td>
                      <Td className="text-xs text-muted">{formatDateTime(q.updated_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canAct && (
              <div className="mt-4 rounded-xl border border-line p-4">
                <h3 className="mb-3 font-semibold text-ink">{open ? "Update your quote" : "Respond with quote"}</h3>
                <QuoteForm
                  action={respondWithQuote}
                  hidden={{ submissionId: sub.id }}
                  insurers={[{ id: ctx.orgId, name: ctx.orgName }]}
                  lockInsurer
                  versions={versions}
                  risk={risk}
                  submitLabel={open ? "Update quote" : "Send quote to broker"}
                  defaults={open ? { insurerId: ctx.orgId, versionId: open.product_version_id ?? undefined, status: open.status, premium: Number(open.premium), excess: open.excess != null ? Number(open.excess) : null, sumInsured: open.sum_insured != null ? Number(open.sum_insured) : null, keyExclusion: open.key_exclusion, validUntil: open.valid_until, note: open.broker_note } : { insurerId: ctx.orgId, status: "awaiting_underwriting" }}
                />
              </div>
            )}
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Actions">
            {closed ? (
              <Notice tone="neutral" title={`Submission ${humanize(sub.status).toLowerCase()}`}>{sub.decline_reason}</Notice>
            ) : !can(ctx, ROLES.underwrite) ? (
              <p className="text-sm text-muted">Underwriters respond to submissions.</p>
            ) : (
              <div className="space-y-4">
                {["pending", "sent"].includes(sub.status) && (
                  <ActionForm action={acknowledgeSubmission} submitLabel="Acknowledge receipt" variant="secondary">
                    <input type="hidden" name="submissionId" value={sub.id} />
                  </ActionForm>
                )}
                <ActionForm action={declineSubmission} submitLabel="Decline risk" variant="outline" confirm="Decline this risk? The broker will be told your reason.">
                  <input type="hidden" name="submissionId" value={sub.id} />
                  <Field label="Reason (shared with the broker)" htmlFor="dec-reason">
                    <Textarea id="dec-reason" name="reason" rows={3} required className="min-h-20 text-sm" />
                  </Field>
                </ActionForm>
              </div>
            )}
          </Section>
          <Section title="Documents delivered by the broker" description="Only documents the broker has confirmed as delivered are shown.">
            {(docs ?? []).length === 0 ? <Empty>None delivered yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {(docs ?? []).map((d) => (
                  <li key={d.id}>
                    <a href={urls.get(d.storage_path) ?? undefined} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand">{d.file_name}</a>
                    <p className="text-xs text-muted">{humanize(d.kind)} · delivered {formatDate(d.delivered_to_insurer_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
