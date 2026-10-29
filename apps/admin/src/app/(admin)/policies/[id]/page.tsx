import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DisclosureBlock, Notice, Pill, StatusPill } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { buildDisclosure, CLAIM_STATUS, PAYMENT_STATUS, POLICY_STATUS } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid, personName, profileMap } from "@/lib/query";
import { formatDate, formatDateTime, formatGHS } from "@/lib/format";
import { Breadcrumb, JsonView, KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";

export default function PolicyDetailPage({ params }: PageProps<"/policies/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading policy…" />}>
      <PolicyDetail params={params} />
    </Suspense>
  );
}

async function PolicyDetail({ params }: Pick<PageProps<"/policies/[id]">, "params">) {
  await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("policies").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const orgIds = [p.insurer_org_id, p.broker_org_id].filter((x): x is string => !!x);
  const [{ data: orgs }, { data: category }, { data: docs }, { data: payments }, { data: claims }] = await Promise.all([
    supabase.from("organizations").select("id, name, nic_licence_number").in("id", orgIds),
    supabase.from("product_categories").select("name").eq("id", p.category_id).single(),
    supabase.from("documents").select("id, kind, file_name, created_at, delivered_to_insurer_at, verified").eq("policy_id", id).order("created_at"),
    supabase.from("payments").select("id, amount, status, provider_reference, paid_at").or(`policy_id.eq.${id}${p.request_id ? `,request_id.eq.${p.request_id}` : ""}`),
    supabase.from("claims").select("id, reference, status, incident_type, reported_at").eq("policy_id", id),
  ]);
  const people = await profileMap(supabase, [p.customer_id, p.issued_by]);
  const org = (oid: string | null) => (orgs ?? []).find((o) => o.id === oid);
  const insurer = org(p.insurer_org_id);
  const broker = org(p.broker_org_id);

  return (
    <>
      <Breadcrumb items={[{ label: "Policies", href: "/policies" }, { label: p.policy_number ?? p.internal_reference }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.policy_number ?? p.internal_reference} <StatusPill meta={POLICY_STATUS[p.status]} /></span>}
        description={`${category?.name ?? ""} · ${insurer?.name ?? ""}${p.nickname ? ` · “${p.nickname}”` : ""}`}
      />
      <Notice tone="info" className="mb-6">
        Only the issuing insurer can activate, cancel or change cover. Payment confirmation alone never activates a policy. Platform staff can view but not change policy status.
      </Notice>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Policy">
            <KeyValues
              cols={3}
              items={[
                { label: "Customer", value: <Link className="text-brand hover:underline" href={`/users/${p.customer_id}`}>{personName(people.get(p.customer_id))}</Link> },
                { label: "Insurer", value: insurer ? <Link className="text-brand hover:underline" href={`/organisations/${insurer.id}`}>{insurer.name}</Link> : p.external_insurer_name ? <span>{p.external_insurer_name} <Pill tone="neutral">Not on platform</Pill></span> : "—" },
                { label: "Broker of record", value: broker ? <Link className="text-brand hover:underline" href={`/organisations/${broker.id}`}>{broker.name}</Link> : "—" },
                { label: "Internal reference", value: p.internal_reference },
                { label: "Insurer policy number", value: p.policy_number ?? "Not yet issued" },
                { label: "Request", value: p.request_id ? <Link className="text-brand hover:underline" href={`/requests/${p.request_id}`}>View request</Link> : "—" },
                { label: "Premium", value: `${formatGHS(p.premium == null ? null : Number(p.premium), { decimals: true })} / ${p.billing_period}` },
                { label: "Sum insured", value: formatGHS(p.sum_insured == null ? null : Number(p.sum_insured)) },
                { label: "Excess", value: formatGHS(p.excess == null ? null : Number(p.excess)) },
                { label: "Cover", value: `${formatDate(p.cover_start)} – ${formatDate(p.cover_end)}` },
                { label: "Issued", value: p.issued_at ? `${formatDateTime(p.issued_at)} by ${personName(people.get(p.issued_by ?? ""), "insurer")}` : "—" },
                { label: "Cancelled", value: p.cancelled_at ? `${formatDateTime(p.cancelled_at)} — ${p.cancellation_reason ?? ""}` : "—" },
              ]}
            />
            {broker && (
              <DisclosureBlock className="mt-5" text={buildDisclosure({ broker: { name: broker.name, licence: broker.nic_licence_number }, insurer: insurer ? { name: insurer.name } : null })} />
            )}
          </Panel>
          <Panel title="Insured items">
            <JsonView value={p.insured_items} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={`Documents (${docs?.length ?? 0})`}>
            <ul className="space-y-2 text-sm">
              {(docs ?? []).map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <span className="truncate text-ink-2">{d.file_name}<span className="block text-xs text-muted">{d.kind.replace(/_/g, " ")} · {formatDate(d.created_at)}</span></span>
                  {d.verified && <Pill tone="ok">Verified</Pill>}
                </li>
              ))}
              {!docs?.length && <li className="text-muted">No documents.</li>}
            </ul>
          </Panel>
          <Panel title="Payments">
            <ul className="space-y-2 text-sm">
              {(payments ?? []).map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <Link href={`/payments?q=${x.provider_reference ?? x.id}`} className="text-brand hover:underline">{formatGHS(Number(x.amount), { decimals: true })}</Link>
                  <StatusPill meta={PAYMENT_STATUS[x.status]} />
                </li>
              ))}
              {!payments?.length && <li className="text-muted">No payments recorded.</li>}
            </ul>
          </Panel>
          <Panel title="Claims">
            <ul className="space-y-2 text-sm">
              {(claims ?? []).map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <Link href={`/claims/${c.id}`} className="text-brand hover:underline">{c.reference}</Link>
                  <StatusPill meta={CLAIM_STATUS[c.status]} />
                </li>
              ))}
              {!claims?.length && <li className="text-muted">No claims.</li>}
            </ul>
          </Panel>
          <Panel title="Renewal reminders sent">
            <JsonView value={p.renewal_reminders_sent} className="max-h-40" />
          </Panel>
        </div>
      </div>
    </>
  );
}
