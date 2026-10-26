import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel } from "lucide-react";
import { Notice, PageHeader, Pill, StatusPill, Timeline } from "@im/ui";
import { CLAIM_DISCLAIMER, CLAIM_STATUS } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, personName, profileMap } from "@/lib/query";
import { formatDateTime, formatGHS } from "@/lib/format";
import { Breadcrumb, JsonView, KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";
import { claimSla } from "../sla";

export default function ClaimDetailPage({ params }: PageProps<"/claims/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading claim…" />}>
      <ClaimDetail params={params} />
    </Suspense>
  );
}

async function ClaimDetail({ params }: Pick<PageProps<"/claims/[id]">, "params">) {
  await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [orgs, { data: events }, { data: docs }, { data: policy }] = await Promise.all([
    orgMap(supabase),
    supabase.from("claim_events").select("*").eq("claim_id", id).order("created_at"),
    supabase.from("documents").select("id, kind, file_name, created_at, delivered_to_insurer_at").eq("claim_id", id),
    supabase.from("policies").select("id, policy_number, internal_reference").eq("id", c.policy_id).maybeSingle(),
  ]);
  const people = await profileMap(supabase, [c.customer_id, c.decision_by, ...(events ?? []).map((e) => e.actor_id)]);
  const sla = claimSla(c);

  return (
    <>
      <Breadcrumb items={[{ label: "Claims", href: "/claims" }, { label: c.reference }]} />
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{c.reference} <StatusPill meta={CLAIM_STATUS[c.status]} /></span>} description={`${c.incident_type} · ${orgs.get(c.insurer_org_id)?.name ?? ""}`} />
      <Notice tone="info" icon={<Gavel className="size-4" />} title="Read-only: decisions are insurer-only" className="mb-6">
        {CLAIM_DISCLAIMER} Platform staff cannot approve, reject or pay claims.
      </Notice>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Claim">
            <KeyValues
              cols={3}
              items={[
                { label: "Customer", value: <Link className="text-brand hover:underline" href={`/users/${c.customer_id}`}>{personName(people.get(c.customer_id))}</Link> },
                { label: "Policy", value: policy ? <Link className="text-brand hover:underline" href={`/policies/${policy.id}`}>{policy.policy_number ?? policy.internal_reference}</Link> : "—" },
                { label: "Broker", value: c.broker_org_id ? orgs.get(c.broker_org_id)?.name : "—" },
                { label: "Incident", value: formatDateTime(c.incident_at) },
                { label: "Location", value: c.location ?? "—" },
                { label: "Amount claimed", value: formatGHS(c.amount_claimed == null ? null : Number(c.amount_claimed), { decimals: true }) },
                { label: "Reported", value: formatDateTime(c.reported_at) },
                { label: "Delivered to insurer", value: formatDateTime(c.delivered_to_insurer_at) },
                { label: "Acknowledged", value: formatDateTime(c.acknowledged_at) },
                { label: "Insurer decision", value: c.decision_at ? `${formatDateTime(c.decision_at)} by ${personName(people.get(c.decision_by ?? ""), "insurer")}` : "Pending" },
                { label: "Decision amount", value: formatGHS(c.decision_amount == null ? null : Number(c.decision_amount), { decimals: true }) },
                { label: "Service level", value: sla ? <Pill tone={sla.tone}>{sla.label}</Pill> : "—" },
              ]}
            />
            {c.description && <p className="mt-4 whitespace-pre-line rounded-xl bg-mist p-4 text-sm text-ink-2">{c.description}</p>}
            {c.decision_note && <p className="mt-3 text-sm text-ink-2"><strong>Insurer note:</strong> {c.decision_note}</p>}
          </Panel>
          <Panel title="Evidence completeness">
            <JsonView value={{ required_evidence: c.required_evidence, completeness: c.completeness }} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Status history">
            <Timeline
              steps={(events ?? []).map((e) => ({
                state: "done" as const,
                title: e.to_status ? CLAIM_STATUS[e.to_status].label : "Note",
                detail: <span>{formatDateTime(e.created_at)} · {e.actor_party}{e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}{e.note && <span className="block text-ink-2">{e.note}</span>}</span>,
              }))}
            />
          </Panel>
          <Panel title={`Documents (${docs?.length ?? 0})`}>
            <ul className="space-y-2 text-sm">
              {(docs ?? []).map((d) => (
                <li key={d.id}>
                  <p className="text-ink-2">{d.file_name}</p>
                  <p className="text-xs text-muted">{d.kind.replace(/_/g, " ")} · {d.delivered_to_insurer_at ? `delivered ${formatDateTime(d.delivered_to_insurer_at)}` : "not yet delivered to insurer"}</p>
                </li>
              ))}
              {!docs?.length && <li className="text-muted">No documents.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
