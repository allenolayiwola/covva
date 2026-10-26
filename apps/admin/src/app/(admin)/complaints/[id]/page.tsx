import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill, Timeline, Notice } from "@im/ui";
import { COMPLAINT_STATUS } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, personName, profileMap } from "@/lib/query";
import { formatDateTime, relativeDue } from "@/lib/format";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { assignComplaint, changeComplaintDue, escalateToNic, setComplaintStatus } from "../actions";

export default function ComplaintDetailPage({ params }: PageProps<"/complaints/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading complaint…" />}>
      <ComplaintDetail params={params} />
    </Suspense>
  );
}

const sel = "mt-1.5 block h-10 w-full rounded-field border border-line bg-white px-3 text-sm";

async function ComplaintDetail({ params }: Pick<PageProps<"/complaints/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("complaints").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [orgs, { data: events }, { data: staffMembers }, { data: ownerMembers }] = await Promise.all([
    orgMap(supabase),
    supabase.from("complaint_events").select("*").eq("complaint_id", id).order("created_at"),
    supabase.from("memberships").select("user_id, org_id, organizations!inner(type)").eq("active", true).eq("organizations.type", "platform").limit(100),
    c.owner_org_id
      ? supabase.from("memberships").select("user_id, org_id").eq("active", true).eq("org_id", c.owner_org_id).limit(200)
      : Promise.resolve({ data: [] as { user_id: string; org_id: string }[] }),
  ]);
  const members = [...(ownerMembers ?? []), ...(staffMembers ?? []).map((m) => ({ user_id: m.user_id, org_id: m.org_id }))];
  const people = await profileMap(supabase, [c.customer_id, c.assigned_to, ...(events ?? []).map((e) => e.actor_id), ...(members ?? []).map((m) => m.user_id)]);
  const canAct = can(staff.roles, "conduct");
  const unresolved = !["resolved", "closed"].includes(c.status);
  const due = relativeDue(c.due_at);
  const assignable = [...new Map((members ?? []).map((m) => [m.user_id, m])).values()];

  return (
    <>
      <Breadcrumb items={[{ label: "Complaints", href: "/complaints" }, { label: c.reference }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.reference} <StatusPill meta={COMPLAINT_STATUS[c.status]} /></span>}
        description={c.subject}
        actions={
          unresolved && c.status !== "escalated_nic" ? (
            <ConfirmAction
              action={escalateToNic}
              fields={{ complaintId: c.id }}
              label="Escalate to NIC"
              title="Flag as escalated to the NIC"
              confirmLabel="Flag escalation"
              disabled={!canAct}
              body="Record that this complaint has been escalated to the National Insurance Commission (by the customer or by us). This does not send anything to the NIC — file the escalation through the official channel."
            />
          ) : null
        }
      />
      <ReadOnlyBanner show={!canAct} />
      {unresolved && due.overdue && <Notice tone="danger" className="mb-5">This complaint is past its resolution deadline ({formatDateTime(c.due_at)}).</Notice>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Complaint">
            <KeyValues
              cols={3}
              items={[
                { label: "Customer", value: <Link className="text-brand hover:underline" href={`/users/${c.customer_id}`}>{personName(people.get(c.customer_id))}</Link> },
                { label: "Against", value: <span className="capitalize">{c.against_party}</span> },
                { label: "Category", value: c.category },
                { label: "Owner", value: c.owner_org_id ? orgs.get(c.owner_org_id)?.name : "Unowned" },
                { label: "Assigned to", value: c.assigned_to ? personName(people.get(c.assigned_to)) : "—" },
                { label: "Resolve by", value: <span className={unresolved && due.overdue ? "text-danger" : ""}>{formatDateTime(c.due_at)}</span> },
                { label: "Acknowledged", value: formatDateTime(c.acknowledged_at) },
                { label: "Escalated", value: formatDateTime(c.escalated_at) },
                { label: "Resolved", value: formatDateTime(c.resolved_at) },
                { label: "Request", value: c.request_id ? <Link className="text-brand hover:underline" href={`/requests/${c.request_id}`}>View</Link> : "—" },
                { label: "Policy", value: c.policy_id ? <Link className="text-brand hover:underline" href={`/policies/${c.policy_id}`}>View</Link> : "—" },
                { label: "Claim", value: c.claim_id ? <Link className="text-brand hover:underline" href={`/claims/${c.claim_id}`}>View</Link> : "—" },
              ]}
            />
            <div className="mt-5 space-y-3 text-sm">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Description</p><p className="mt-1 whitespace-pre-line text-ink-2">{c.description}</p></div>
              {c.desired_outcome && <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Desired outcome</p><p className="mt-1 text-ink-2">{c.desired_outcome}</p></div>}
              {c.outcome && <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Outcome</p><p className="mt-1 text-ink-2">{c.outcome}</p></div>}
            </div>
          </Panel>

          <Panel title="Update status" description="Resolving or closing requires the outcome communicated to the customer.">
            <ActionForm action={setComplaintStatus} submitLabel="Update status" readOnly={!canAct}>
              <input type="hidden" name="complaintId" value={c.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-ink-2">
                  New status
                  <select name="status" defaultValue={c.status === "open" ? "acknowledged" : c.status === "acknowledged" ? "investigating" : "resolved"} className={sel}>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="investigating">Investigating</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-ink-2">
                  Internal note
                  <input name="reason" required minLength={5} className={sel} placeholder="What changed and why" />
                </label>
              </div>
              <label className="block text-sm font-medium text-ink-2">
                Outcome (shown to the customer)
                <textarea name="outcome" defaultValue={c.outcome ?? ""} className="mt-1.5 block min-h-24 w-full rounded-field border border-line p-3 text-sm" />
              </label>
            </ActionForm>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Ownership">
            <ActionForm action={assignComplaint} submitLabel="Save owner" readOnly={!canAct}>
              <input type="hidden" name="complaintId" value={c.id} />
              <label className="block text-sm font-medium text-ink-2">
                Owner organisation
                <select name="ownerOrgId" defaultValue={c.owner_org_id ?? ""} className={sel}>
                  <option value="">Unowned</option>
                  {[...orgs.values()].map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-ink-2">
                Assigned person
                <select name="assignedTo" defaultValue={c.assigned_to ?? ""} className={sel}>
                  <option value="">Nobody</option>
                  {assignable.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{personName(people.get(m.user_id))} · {orgs.get(m.org_id)?.name}</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted">People listed: members of the owner organisation and platform staff. Save the owner first to see its members.</p>
            </ActionForm>
          </Panel>
          <Panel title="Resolution deadline">
            <ActionForm action={changeComplaintDue} submitLabel="Change deadline" readOnly={!canAct}>
              <input type="hidden" name="complaintId" value={c.id} />
              <input type="date" name="dueAt" required defaultValue={c.due_at.slice(0, 10)} className={sel} aria-label="New due date" />
              <input name="reason" required minLength={5} placeholder="Reason" className={sel} aria-label="Reason" />
            </ActionForm>
          </Panel>
          <Panel title="Events">
            <Timeline
              steps={(events ?? []).map((e) => ({
                state: "done" as const,
                title: e.to_status ? COMPLAINT_STATUS[e.to_status].label : "Note",
                detail: <span>{formatDateTime(e.created_at)} · {e.actor_party}{e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}{e.note && <span className="block text-ink-2">{e.note}</span>}</span>,
              }))}
            />
            {!events?.length && <p className="text-sm text-muted">No events.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
