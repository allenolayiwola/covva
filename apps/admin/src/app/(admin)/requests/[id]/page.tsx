import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill, Pill, Notice, Timeline, Table, THead, Th, Td } from "@im/ui";
import { OPEN_REQUEST_STATUSES, PAYMENT_STATUS, POLICY_STATUS, QUOTE_STATUS, REQUEST_STATUS } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, personName, profileMap } from "@/lib/query";
import { formatDateTime, formatGHS, relativeDue } from "@/lib/format";
import { Breadcrumb, JsonView, KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { addInternalNote, cancelRequest, completeBrokerHandover, reassignBroker } from "../actions";

export default function RequestDetailPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading request…" />}>
      <RequestDetail params={params} />
    </Suspense>
  );
}

async function RequestDetail({ params }: Pick<PageProps<"/requests/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();

  const { data: r } = await supabase.from("requests").select("*").eq("id", id).maybeSingle();
  if (!r) notFound();

  const [orgs, { data: category }, { data: events }, { data: quotes }, { data: disclosures }, { data: tasks }, { data: payments }, { data: policies }] =
    await Promise.all([
      orgMap(supabase),
      supabase.from("product_categories").select("name, slug").eq("id", r.category_id).single(),
      supabase.from("request_events").select("*").eq("request_id", id).order("created_at"),
      supabase.from("quotes").select("id, insurer_org_id, status, premium, valid_until, created_at, is_binding, paid_placement").eq("request_id", id).order("created_at"),
      supabase.from("broker_disclosures").select("*").eq("request_id", id).order("acknowledged_at"),
      supabase.from("request_tasks").select("id, title, status, assignee_party, due_at").eq("request_id", id).order("created_at"),
      supabase.from("payments").select("id, amount, status, provider_reference, paid_at, reconciled").eq("request_id", id),
      supabase.from("policies").select("id, internal_reference, policy_number, status").eq("request_id", id),
    ]);
  const people = await profileMap(supabase, [r.customer_id, r.assigned_to, ...(events ?? []).map((e) => e.actor_id)]);
  const open = OPEN_REQUEST_STATUSES.includes(r.status) || r.status === "draft";
  const due = relativeDue(r.due_at);
  const routing = (events ?? []).filter((e) => /rout|broker_assigned|broker_reassigned|offer/.test(e.event));
  const brokers = [...orgs.values()].filter((o) => o.type === "broker" && o.status === "active" && o.id !== r.broker_org_id);
  const canAct = can(staff.roles, "operations");
  // Consented hand-over waiting for completion: a broker_change disclosure for a broker other than the current one.
  const consented = (disclosures ?? []).filter((d) => d.stage === "broker_change" && d.broker_org_id !== r.broker_org_id);
  const pendingHandover = open && consented.length > 0 && (events ?? []).some((e) => e.event === "broker_change_proposed") ? consented[consented.length - 1] : null;

  return (
    <>
      <Breadcrumb items={[{ label: "Requests", href: "/requests" }, { label: r.reference }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{r.reference} <StatusPill meta={REQUEST_STATUS[r.status]} /></span>}
        description={`${category?.name ?? "Category"} · ${r.type.replace("_", " ")} · via ${r.source.replace("_", " ")}`}
        actions={
          open ? (
            <>
              {pendingHandover && (
                <ConfirmAction
                  action={completeBrokerHandover}
                  fields={{ requestId: r.id, brokerOrgId: pendingHandover.broker_org_id }}
                  label={`Complete hand-over to ${orgs.get(pendingHandover.broker_org_id)?.name ?? "new broker"}`}
                  title="Complete broker hand-over"
                  triggerVariant="primary"
                  variant="primary"
                  confirmLabel="Complete hand-over"
                  requireReason={false}
                  disabled={!canAct}
                  body={
                    <p>
                      The customer agreed to {orgs.get(pendingHandover.broker_org_id)?.name} on {formatDateTime(pendingHandover.acknowledged_at)}. Completing moves the
                      request, unassigns the adviser and tells both brokers and the customer.
                    </p>
                  }
                />
              )}
              <ConfirmAction
                action={reassignBroker}
                fields={{ requestId: r.id }}
                label="Reassign broker"
                title="Reassign broker of record"
                triggerVariant="secondary"
                variant="primary"
                confirmLabel="Record disclosure & reassign"
                disabled={!canAct}
                body={
                  <>
                    <p>
                      One broker of record per request. The broker can only change after the customer has been told — a{" "}
                      <code>broker_change</code> disclosure naming the new broker is recorded first, then the request moves. The database blocks
                      the change otherwise.
                    </p>
                  </>
                }
              >
                <label className="block text-sm font-medium text-ink-2">
                  New broker of record
                  <select name="brokerOrgId" required className="mt-1.5 block h-10 w-full rounded-field border border-line px-3 text-sm">
                    <option value="">Choose…</option>
                    {brokers.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-ink-2">
                  How was the customer told?
                  <select name="method" defaultValue="call" className="mt-1.5 block h-10 w-full rounded-field border border-line px-3 text-sm">
                    <option value="call">Phone call</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="in_app">In-app message</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm text-ink-2">
                  <input type="checkbox" name="customerNotified" className="mt-0.5 size-4 accent-brand" />
                  The customer has been told the new broker&apos;s name and licence, and why the broker is changing.
                </label>
              </ConfirmAction>
              <ConfirmAction
                action={cancelRequest}
                fields={{ requestId: r.id }}
                label="Cancel request"
                title={`Cancel ${r.reference}`}
                confirmLabel="Cancel request"
                confirmWord="CANCEL"
                disabled={!canAct}
                body="Requests are never deleted. Cancelling closes the request with your reason, visible on the customer's timeline."
              />
            </>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Summary">
            <KeyValues
              cols={3}
              items={[
                { label: "Customer", value: <Link className="text-brand hover:underline" href={`/users/${r.customer_id}`}>{personName(people.get(r.customer_id))}</Link> },
                { label: "Broker of record", value: r.broker_org_id ? <Link className="text-brand hover:underline" href={`/organisations/${r.broker_org_id}`}>{orgs.get(r.broker_org_id)?.name}</Link> : <Pill tone="wait">Unassigned</Pill> },
                { label: "Adviser", value: r.assigned_to ? personName(people.get(r.assigned_to)) : "—" },
                { label: "Team", value: r.team ?? "—" },
                { label: "Due", value: <span className={due.overdue ? "text-danger" : ""}>{r.due_at ? `${formatDateTime(r.due_at)} (${due.label})` : "—"}</span> },
                { label: "SLA breached at", value: r.sla_breached_at ? formatDateTime(r.sla_breached_at) : "—" },
                { label: "Submitted", value: formatDateTime(r.submitted_at) },
                { label: "Completed", value: formatDateTime(r.completed_at) },
                { label: "Next step", value: r.next_step ?? "—" },
                { label: "Adviser review needed", value: r.needs_adviser_review ? "Yes" : "No" },
                { label: "Priority", value: r.priority },
                { label: "Cancelled reason", value: r.cancelled_reason ?? "—" },
              ]}
            />
          </Panel>

          <Panel title={`Quotes (${quotes?.length ?? 0})`} bodyClassName="p-0">
            <Table className="rounded-none border-0">
              <THead><tr><Th>Insurer</Th><Th>Status</Th><Th>Premium</Th><Th>Valid until</Th><Th>Created</Th></tr></THead>
              <tbody>
                {(quotes ?? []).map((q) => (
                  <tr key={q.id}>
                    <Td>{orgs.get(q.insurer_org_id)?.name}{q.paid_placement && <Pill tone="wait" className="ml-2">Paid placement</Pill>}</Td>
                    <Td><StatusPill meta={QUOTE_STATUS[q.status]} /></Td>
                    <Td className="tabular-nums">{formatGHS(Number(q.premium), { decimals: true })}</Td>
                    <Td>{formatDateTime(q.valid_until)}</Td>
                    <Td>{formatDateTime(q.created_at)}</Td>
                  </tr>
                ))}
                {!quotes?.length && <tr><Td colSpan={5} className="text-center text-muted">No quotes yet.</Td></tr>}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Risk data" description="As submitted by the customer (common internal format).">
            <JsonView value={r.risk_data} />
          </Panel>

          <Panel title="Timeline">
            <Timeline
              steps={(events ?? []).map((e) => ({
                state: "done" as const,
                title: (
                  <span>
                    {e.event.replace(/_/g, " ")}
                    {e.to_status && <> → {REQUEST_STATUS[e.to_status].label}</>}
                    {!e.visible_to_customer && <Pill tone="neutral" className="ml-2">internal</Pill>}
                  </span>
                ),
                detail: (
                  <span>
                    {formatDateTime(e.created_at)} · {e.actor_party}
                    {e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}
                    {e.note ? <span className="mt-0.5 block text-ink-2">{e.note}</span> : null}
                  </span>
                ),
              }))}
            />
            <div className="mt-5 border-t border-line pt-4">
              <ActionForm action={addInternalNote} submitLabel="Add internal note" readOnly={!canAct}>
                <input type="hidden" name="requestId" value={r.id} />
                <textarea name="note" required minLength={2} placeholder="Internal note (not shown to the customer)" className="block min-h-20 w-full rounded-field border border-line p-3 text-sm" />
              </ActionForm>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Routing decision"
            description={`Mode: ${r.routing_mode ? r.routing_mode.replace(/_/g, " ") : "legacy (assigned at creation)"}${r.complexity_flags?.length ? ` · ${r.complexity_flags.join(", ")}` : ""}${r.talk_to_expert ? " · talk to an expert" : ""}`}
            actions={<Link href={`/routing/integrations?request=${r.id}`} className="text-sm text-brand hover:underline">Offers &amp; candidates →</Link>}
          >
            {routing.length ? (
              <ul className="space-y-3">
                {routing.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="font-medium text-ink">{e.event.replace(/_/g, " ")} · {formatDateTime(e.created_at)}</p>
                    {e.note && <p className="text-muted">{e.note}</p>}
                    {e.data && Object.keys(e.data as object).length > 0 && <JsonView value={e.data} className="mt-2 max-h-56" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No routing event recorded.</p>
            )}
          </Panel>

          <Panel title="Broker disclosures" description="Shown to the customer before advice / application / broker change.">
            {disclosures?.length ? (
              <ul className="space-y-3 text-sm">
                {disclosures.map((d) => (
                  <li key={d.id}>
                    <p className="font-medium text-ink">{d.stage.replace(/_/g, " ")} · {orgs.get(d.broker_org_id)?.name}</p>
                    <p className="text-xs text-muted">{formatDateTime(d.acknowledged_at)} via {d.method}</p>
                    <p className="mt-1 text-xs text-ink-2">{d.disclosure_text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="wait">No disclosure yet — the customer cannot apply until the broker of record is disclosed.</Notice>
            )}
          </Panel>

          <Panel title="Tasks">
            {tasks?.length ? (
              <ul className="space-y-2 text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className={t.status === "done" ? "text-muted line-through" : "text-ink-2"}>{t.title}</span>
                    <Pill tone={t.status === "open" ? "wait" : "neutral"}>{t.assignee_party} · {t.status}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No tasks.</p>
            )}
          </Panel>

          <Panel title="Payments & policy">
            <ul className="space-y-2 text-sm">
              {(payments ?? []).map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <Link href={`/payments?q=${p.provider_reference ?? p.id}`} className="text-brand hover:underline">{formatGHS(Number(p.amount), { decimals: true })}</Link>
                  <span className="flex gap-1"><StatusPill meta={PAYMENT_STATUS[p.status]} />{p.reconciled && <Pill tone="ok">Reconciled</Pill>}</span>
                </li>
              ))}
              {(policies ?? []).map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <Link href={`/policies/${p.id}`} className="text-brand hover:underline">{p.policy_number ?? p.internal_reference}</Link>
                  <StatusPill meta={POLICY_STATUS[p.status]} />
                </li>
              ))}
              {!payments?.length && !policies?.length && <li className="text-muted">No payments or policies yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
