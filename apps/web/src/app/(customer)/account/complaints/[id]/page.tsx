import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { COMPLAINT_STATUS, daysUntil, formatDate, formatDateTime } from "@im/core";
import { Card, DefinitionList, Notice, StatusPill, Timeline, type TimelineStep } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UUID_RE, account } from "../../_lib/data";
import { COMPLAINT_CATEGORY_LABEL, PARTY_LABEL } from "../../_lib/labels";

export const metadata: Metadata = { title: "Complaint" };

export default function ComplaintPage({ params, searchParams }: PageProps<"/account/complaints/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/account/complaints/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const { supabase } = await account(`/account/complaints/${id}`);
  const { data: c } = await supabase
    .from("complaints")
    .select("*, owner:organizations!complaints_owner_org_id_fkey(name), request:requests(id, reference), policy:policies(id, nickname, policy_number, internal_reference), claim:claims(id, reference)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const complaint = c as typeof c & {
    owner: { name: string } | null;
    request: { id: string; reference: string } | null;
    policy: { id: string; nickname: string | null; policy_number: string | null; internal_reference: string } | null;
    claim: { id: string; reference: string } | null;
  };
  const { data: events } = await supabase.from("complaint_events").select("id, to_status, note, actor_party, created_at").eq("complaint_id", id).order("created_at", { ascending: true });

  const closed = ["resolved", "closed"].includes(complaint.status);
  const days = daysUntil(complaint.due_at);
  const steps: TimelineStep[] = (events ?? []).map((e, i, arr) => ({
    title: e.to_status ? (i === 0 ? "Complaint filed" : COMPLAINT_STATUS[e.to_status].label) : e.note ?? "Update",
    detail: (
      <>
        {formatDateTime(e.created_at)} · {PARTY_LABEL[e.actor_party] ?? e.actor_party}
        {e.to_status && e.note ? <span className="block text-ink-2">{e.note}</span> : null}
      </>
    ),
    state: i === arr.length - 1 && !closed ? "current" : "done",
  }));
  if (!closed) {
    if (!["acknowledged", "investigating", "escalated_nic"].includes(complaint.status)) steps.push({ title: "Acknowledged", state: "upcoming" });
    if (complaint.status !== "investigating" && complaint.status !== "escalated_nic") steps.push({ title: "Investigating", state: "upcoming" });
    steps.push({ title: "Final response", detail: `Target: ${formatDate(complaint.due_at)}`, state: "upcoming" });
  }
  const handler = complaint.against_party === "platform" ? "Insurance Marketplace support" : complaint.owner?.name ?? `the ${complaint.against_party}`;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Complaints", href: "/account/complaints" }, { label: complaint.reference }]} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[34px]">{complaint.subject}</h1>
        <StatusPill meta={COMPLAINT_STATUS[complaint.status]} />
      </div>
      <p className="mt-1 text-[15px] text-muted">
        {complaint.reference} · {COMPLAINT_CATEGORY_LABEL[complaint.category] ?? complaint.category} · Handled by {handler}
      </p>
      {sp.filed && (
        <Notice tone="ok" className="mt-5" title="Complaint filed">
          {handler} has been told. They should acknowledge it promptly and aim to resolve it by {formatDate(complaint.due_at)}.
        </Notice>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-8">
          <Timeline steps={steps} />
          {complaint.outcome && (
            <Card className="p-5">
              <p className="font-semibold text-ink">Outcome</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{complaint.outcome}</p>
            </Card>
          )}
          <section>
            <h2 className="text-lg font-semibold text-ink">What you told us</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{complaint.description}</p>
            {complaint.desired_outcome && (
              <>
                <h3 className="mt-4 text-sm font-semibold text-ink">What would put it right</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{complaint.desired_outcome}</p>
              </>
            )}
          </section>
        </div>
        <aside className="space-y-5">
          <Card className="p-5">
            <DefinitionList
              items={[
                { label: "Filed", value: formatDate(complaint.created_at) },
                {
                  label: "Resolution target",
                  value: closed ? formatDate(complaint.resolved_at ?? complaint.due_at) : `${formatDate(complaint.due_at)}${days !== null ? (days >= 0 ? ` (${days} day${days === 1 ? "" : "s"})` : " (overdue)") : ""}`,
                },
                ...(complaint.request ? [{ label: "Request", value: <Link className="text-brand hover:underline" href={`/account/requests/${complaint.request.id}`}>{complaint.request.reference}</Link> }] : []),
                ...(complaint.policy
                  ? [{ label: "Policy", value: <Link className="text-brand hover:underline" href={`/account/policies/${complaint.policy.id}`}>{complaint.policy.nickname ?? complaint.policy.policy_number ?? complaint.policy.internal_reference}</Link> }]
                  : []),
                ...(complaint.claim ? [{ label: "Claim", value: <Link className="text-brand hover:underline" href={`/account/claims/${complaint.claim.id}`}>{complaint.claim.reference}</Link> }] : []),
              ]}
            />
          </Card>
          <Notice tone={days !== null && days < 0 && !closed ? "wait" : "info"} title="Not happy with the response?">
            Firms aim to resolve complaints within 14 days. If you don&apos;t get a final response in that time, or you disagree with it, you can
            escalate to the National Insurance Commission (NIC) complaints unit — it&apos;s free. Quote your reference {complaint.reference}.
          </Notice>
        </aside>
      </div>
    </div>
  );
}
