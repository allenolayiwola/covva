import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Checkbox, DemoBadge, Field, Input, Pill, Select, StatusPill, Table, Td, Textarea, Th, THead, Timeline } from "@im/ui";
import {
  type ComparableQuote,
  LABELS,
  PAYMENT_STATUS,
  POLICY_STATUS,
  QUOTE_STATUS,
  REQUEST_STATUS,
  REQUEST_TRANSITIONS,
  buildDisclosure,
  compareQuotes,
  comparisonSummary,
  formatDate,
  formatDateTime,
  formatGHS,
  humanize,
  type RiskField,
} from "@im/core";
import { can, getPartnerContext, ROLES } from "../../../_lib/context";
import { APPLICATION_LABEL, getCategoryMap, getCustomers, getOrgNames, getTeam, fullName, requestKind, SOURCE_LABEL, teamsOf } from "../../../_lib/data";
import { customerConsents } from "../../../_lib/privileged";
import { ActionForm } from "@/components/partner/action-form";
import { FulfilmentCard } from "@/components/partner/queue-table";
import { QuoteForm, type VersionOption } from "@/components/partner/quote-form";
import { RealtimeRefresh } from "@/components/partner/realtime-refresh";
import { riskDisplay } from "@/components/partner/risk-fields";
import { DueCell, Empty, KV, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import {
  assignRequest,
  completeBrokerChange,
  createTask,
  deliverPolicyDocuments,
  documentAction,
  requestBrokerChange,
  saveQuote,
  sendMessage,
  sendQuotesToCustomer,
  setQuoteStatus,
  submitToInsurer,
  transitionRequest,
  updateTask,
} from "./actions";

export const metadata: Metadata = { title: "Request" };

export default function RequestWorkspacePage({ params }: PageProps<"/partner/requests/[id]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} rows={8} /></>}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPartnerContext();
  if (ctx.kind !== "broker") notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = ctx.supabase;

  const { data: req } = await sb.from("requests").select("*").eq("id", id).maybeSingle();
  if (!req || req.broker_org_id !== ctx.orgId) notFound();

  const [cats, customers, team, events, tasks, submissions, quotes, messages, documents, applications, payments, policies, appointments, disclosures] = await Promise.all([
    getCategoryMap(),
    getCustomers(ctx, [req.customer_id]),
    getTeam(ctx),
    sb.from("request_events").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_tasks").select("*").eq("request_id", id).order("created_at"),
    sb.from("insurer_submissions").select("*").eq("request_id", id).order("created_at"),
    sb.from("quotes").select("*").eq("request_id", id).order("created_at"),
    sb.from("request_messages").select("*").eq("request_id", id).order("created_at"),
    sb.from("documents").select("*").eq("request_id", id).order("created_at"),
    sb.from("applications").select("id, status, submitted_at, decided_at, decision_note, quote_id").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("payments").select("id, status, amount, channel, paid_at, provider_reference").eq("request_id", id).order("created_at", { ascending: false }),
    sb.from("policies").select("id, status, policy_number, internal_reference, cover_start, cover_end, insurer_org_id").eq("request_id", id),
    sb.from("insurer_broker_appointments").select("insurer_org_id, category_id").eq("broker_org_id", ctx.orgId).eq("active", true),
    sb.from("broker_disclosures").select("broker_org_id, stage, acknowledged_at").eq("request_id", id),
  ]);

  const category = cats.get(req.category_id);
  const schema = ((category?.risk_schema ?? []) as unknown as RiskField[]);
  const customer = customers.get(req.customer_id);
  const risk = (req.risk_data ?? {}) as Record<string, unknown>;
  const appointedIds = [...new Set((appointments.data ?? []).filter((a) => !a.category_id || a.category_id === req.category_id).map((a) => a.insurer_org_id))];
  const quoteRows = quotes.data ?? [];
  const subRows = submissions.data ?? [];
  const orgNames = await getOrgNames(ctx, [...appointedIds, ...quoteRows.map((q) => q.insurer_org_id), ...subRows.map((s) => s.insurer_org_id)]);

  const [{ data: products }, consents, signed, brokerDir] = await Promise.all([
    appointedIds.length
      ? sb
          .from("products")
          .select("id, name, insurer_org_id, version:product_versions!products_current_version_fk(id, version, status, rating, excesses, key_exclusion)")
          .eq("category_id", req.category_id)
          .eq("status", "approved")
          .in("insurer_org_id", appointedIds)
      : Promise.resolve({ data: [] }),
    customerConsents(req.customer_id),
    (documents.data ?? []).length
      ? sb.storage.from("documents").createSignedUrls((documents.data ?? []).map((d) => d.storage_path), 600)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    ctx.isSupervisor ? sb.from("organizations").select("id, name").eq("type", "broker").eq("status", "active").neq("id", ctx.orgId).order("name") : Promise.resolve({ data: [] }),
  ]);
  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const versions: VersionOption[] = ((products ?? []) as unknown as { id: string; name: string; insurer_org_id: string; version: { id: string; version: number; status: string; rating: unknown; excesses: Record<string, unknown>; key_exclusion: string | null } | null }[])
    .filter((p) => p.version && p.version.status === "approved")
    .map((p) => ({ id: p.version!.id, insurerId: p.insurer_org_id, label: `${p.name} · v${p.version!.version}`, rating: p.version!.rating, excesses: p.version!.excesses ?? {}, keyExclusion: p.version!.key_exclusion }));

  const members = new Map(team.map((m) => [m.userId, m]));
  const assignee = req.assigned_to ? members.get(req.assigned_to) : undefined;
  const canWork = can(ctx, ROLES.brokerWork);
  const transitions = REQUEST_TRANSITIONS[req.status].filter((t) => t.by.includes("broker"));
  const liveSubs = subRows.filter((s) => !["declined", "error", "withdrawn"].includes(s.status));
  const notSubmitted = appointedIds.filter((i) => !liveSubs.some((s) => s.insurer_org_id === i));
  const liveQuotes = quoteRows.filter((q) => ["estimate", "awaiting_underwriting", "ready_to_accept"].includes(q.status));
  const policy = (policies.data ?? [])[0];
  const payment = (payments.data ?? [])[0];
  const application = (applications.data ?? [])[0];
  const checkpoints = [
    quoteRows.some((q) => q.status === "accepted") || !!application,
    (payments.data ?? []).some((p) => p.status === "succeeded"),
    policy?.status === "active",
    req.status === "completed",
  ];
  const currentBrokerName = ctx.orgName;
  const changeDisclosures = (disclosures.data ?? []).filter((d) => d.stage === "broker_change" && d.broker_org_id !== ctx.orgId);

  const comparison = compareQuotes(
    liveQuotes.map<ComparableQuote>((q) => ({
      id: q.id,
      insurerId: q.insurer_org_id,
      insurerName: orgNames.get(q.insurer_org_id) ?? "Insurer",
      status: q.status,
      premium: Number(q.premium),
      excess: q.excess != null ? Number(q.excess) : null,
      sumInsured: q.sum_insured != null ? Number(q.sum_insured) : null,
      coverage: (q.coverage as unknown as ComparableQuote["coverage"]) ?? [],
      exclusions: q.exclusions,
      keyExclusion: q.key_exclusion,
      waitingPeriodDays: q.waiting_period_days,
      optionalBenefits: (q.optional_benefits as unknown as ComparableQuote["optionalBenefits"]) ?? [],
      validUntil: q.valid_until,
      paidPlacement: q.paid_placement,
    })),
  );

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/requests" className="hover:text-brand">Request queue</Link> <span aria-hidden>›</span> {req.reference}
      </nav>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
            {req.reference} · {fullName(customer)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{requestKind(category?.name, req.type)}</span>
            <span aria-hidden>·</span>
            <span>{SOURCE_LABEL[req.source]}</span>
            <StatusPill meta={REQUEST_STATUS[req.status]} />
            {req.needs_adviser_review && <Pill tone="info">Adviser review</Pill>}
            <RealtimeRefresh table="requests" filter={`id=eq.${req.id}`} channel={`req-${req.id}`} />
          </div>
          {req.next_step && <p className="mt-2 text-sm text-ink-2"><span className="text-muted">Customer sees:</span> {req.next_step}</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-4 rounded-card border border-line bg-white p-4 text-sm sm:min-w-[340px]">
          <div><p className="text-xs uppercase tracking-wider text-muted">Next response</p><DueCell dueAt={req.due_at} /></div>
          <div><p className="text-xs uppercase tracking-wider text-muted">Owner</p><p className="font-semibold text-ink">{req.team ?? assignee?.team ?? "No team"}</p><p className="text-xs text-subtle">{assignee?.name ?? "Unassigned"}</p></div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Status ------------------------------------------------------------ */}
          <Section title="Move the request forward" description="Only the steps a broker can take from here are shown.">
            {transitions.length === 0 ? (
              <Empty>{req.status === "payment_confirmation" ? "Waiting for the payment provider to confirm. The system moves this on automatically." : "No further broker steps from this status."}</Empty>
            ) : canWork ? (
              <ActionForm action={transitionRequest} submitLabel="Update status">
                <input type="hidden" name="requestId" value={req.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="New status" htmlFor="tr-to">
                    <Select id="tr-to" name="to" className="h-10 text-sm">
                      {transitions.map((t) => <option key={t.to} value={t.to}>{REQUEST_STATUS[t.to].label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Next step shown to the customer" htmlFor="tr-next">
                    <Input id="tr-next" name="nextStep" placeholder="e.g. We're confirming prices with insurers." className="h-10 text-sm" />
                  </Field>
                </div>
                <Field label="Note (optional)" htmlFor="tr-note">
                  <Textarea id="tr-note" name="note" rows={2} className="min-h-16 text-sm" />
                </Field>
                <Checkbox name="share" label="Share this note with the customer" />
              </ActionForm>
            ) : (
              <Empty>Your role can view this request but not change it.</Empty>
            )}
          </Section>

          {/* Tasks ------------------------------------------------------------- */}
          <Section id="tasks" title="Tasks and document requests" description="Requests to the customer appear in their tracker and notifications.">
            {(tasks.data ?? []).length > 0 && (
              <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
                {(tasks.data ?? []).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className={t.status === "done" ? "text-sm font-medium text-brand" : t.status === "cancelled" ? "text-sm text-subtle line-through" : "text-sm font-medium text-ink"}>
                        {t.status === "done" ? "✓ " : "○ "}{t.title}
                      </p>
                      <p className="text-xs text-muted">
                        {humanize(t.kind)} · for {t.assignee_party}{t.due_at ? ` · due ${formatDate(t.due_at)}` : ""}{t.document_kind ? ` · ${humanize(t.document_kind)}` : ""}
                      </p>
                    </div>
                    {canWork && t.status === "open" && (
                      <div className="flex gap-2">
                        <ActionForm action={updateTask} submitLabel="Mark done" variant="secondary" inline>
                          <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="status" value="done" />
                        </ActionForm>
                        <ActionForm action={updateTask} submitLabel="Cancel" variant="ghost" inline>
                          <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="status" value="cancelled" />
                        </ActionForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWork && (
              <details className="rounded-xl border border-line p-4" open={(tasks.data ?? []).length === 0}>
                <summary className="cursor-pointer text-sm font-semibold text-brand">Request a document or information</summary>
                <ActionForm action={createTask} submitLabel="Send to customer" resetOnSuccess className="mt-3 space-y-3">
                  <input type="hidden" name="requestId" value={req.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Type" htmlFor="tk-kind">
                      <Select id="tk-kind" name="kind" className="h-10 text-sm"><option value="document">Document</option><option value="information">Information</option></Select>
                    </Field>
                    <Field label="Document" htmlFor="tk-doc">
                      <Select id="tk-doc" name="documentKind" className="h-10 text-sm">
                        <option value="">—</option>
                        {(category?.required_documents ?? []).map((d) => <option key={d} value={d}>{humanize(d)} (required)</option>)}
                        {["id_document", "vehicle_registration", "drivers_licence", "photo", "proof_of_address", "medical", "receipt", "police_report", "invoice", "other"].filter((d) => !(category?.required_documents ?? []).includes(d as never)).map((d) => <option key={d} value={d}>{humanize(d)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Due" htmlFor="tk-due">
                      <Input id="tk-due" name="due" type="date" className="h-10 text-sm" />
                    </Field>
                  </div>
                  <Field label="What do you need?" htmlFor="tk-title">
                    <Input id="tk-title" name="title" required placeholder="Vehicle registration document" className="h-10 text-sm" />
                  </Field>
                  <Field label="Details for the customer" htmlFor="tk-detail">
                    <Textarea id="tk-detail" name="detail" rows={2} className="min-h-16 text-sm" />
                  </Field>
                  <Checkbox name="wait" defaultChecked label="Set status to “Awaiting customer information”" />
                </ActionForm>
              </details>
            )}
          </Section>

          {/* Submissions ------------------------------------------------------- */}
          <Section title="Insurer submissions" description="Each risk can be submitted to an insurer once. Duplicates are blocked.">
            {subRows.length === 0 ? (
              <Empty>Not submitted to any insurer yet.</Empty>
            ) : (
              <Table>
                <THead><tr><Th>Insurer</Th><Th>Status</Th><Th>Channel</Th><Th>Response due</Th></tr></THead>
                <tbody>
                  {subRows.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-medium text-ink">{orgNames.get(s.insurer_org_id) ?? "Insurer"}{s.decline_reason && <p className="text-xs text-danger">Declined: {s.decline_reason}</p>}</Td>
                      <Td><Pill tone={s.status === "quoted" ? "ok" : s.status === "declined" || s.status === "error" ? "danger" : "wait"}>{humanize(s.status)}</Pill></Td>
                      <Td>{humanize(s.channel)}</Td>
                      <Td>{s.responded_at ? <span className="text-sm text-muted">Responded {formatDateTime(s.responded_at)}</span> : <DueCell dueAt={s.response_due_at} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canWork && (
              notSubmitted.length > 0 ? (
                <ActionForm action={submitToInsurer} submitLabel="Submit to insurer" className="mt-4 space-y-3">
                  <input type="hidden" name="requestId" value={req.id} />
                  <Field label="Appointed insurer" htmlFor="sb-ins">
                    <Select id="sb-ins" name="insurerOrgId" className="h-10 text-sm">
                      {notSubmitted.map((i) => <option key={i} value={i}>{orgNames.get(i) ?? "Insurer"}</option>)}
                    </Select>
                  </Field>
                  <Checkbox name="move" defaultChecked label="Move request to “Awaiting insurers”" />
                </ActionForm>
              ) : (
                <p className="mt-3 text-sm text-muted">{appointedIds.length ? "Submitted to every appointed insurer for this category." : "No insurers have appointed your organisation for this category."}</p>
              )
            )}
          </Section>

          {/* Quotes ------------------------------------------------------------ */}
          <Section id="quotes" title="Quotes" description="Estimate → awaiting underwriting → ready to accept. Only ready-to-accept quotes are binding.">
            {quoteRows.length === 0 ? (
              <Empty>No quotes yet.</Empty>
            ) : (
              <Table>
                <THead><tr><Th>Insurer</Th><Th>Status</Th><Th>Premium</Th><Th>Excess</Th><Th>Valid until</Th><Th>Actions</Th></tr></THead>
                <tbody>
                  {quoteRows.map((q) => (
                    <tr key={q.id}>
                      <Td className="font-medium text-ink">
                        {orgNames.get(q.insurer_org_id) ?? "Insurer"}
                        {q.key_exclusion && <p className="text-xs font-normal text-muted">Key exclusion: {q.key_exclusion}</p>}
                      </Td>
                      <Td><StatusPill meta={QUOTE_STATUS[q.status]} /></Td>
                      <Td className="tabular-nums">{formatGHS(Number(q.premium))}</Td>
                      <Td className="tabular-nums">{formatGHS(q.excess != null ? Number(q.excess) : null)}</Td>
                      <Td>{formatDate(q.valid_until)}</Td>
                      <Td>
                        {canWork && ["estimate", "awaiting_underwriting", "ready_to_accept"].includes(q.status) ? (
                          <div className="flex flex-wrap gap-1.5">
                            {q.status !== "ready_to_accept" && (
                              <ActionForm action={setQuoteStatus} submitLabel="Mark ready" variant="secondary" inline confirm="Mark this quote as a binding offer the customer can accept? Confirm the insurer has agreed the price.">
                                <input type="hidden" name="quoteId" value={q.id} /><input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="status" value="ready_to_accept" />
                              </ActionForm>
                            )}
                            {q.status === "estimate" && (
                              <ActionForm action={setQuoteStatus} submitLabel="To underwriting" variant="outline" inline>
                                <input type="hidden" name="quoteId" value={q.id} /><input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="status" value="awaiting_underwriting" />
                              </ActionForm>
                            )}
                            <ActionForm action={setQuoteStatus} submitLabel="Withdraw" variant="ghost" inline confirm="Withdraw this quote? The customer will no longer see it.">
                              <input type="hidden" name="quoteId" value={q.id} /><input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="status" value="withdrawn" />
                            </ActionForm>
                          </div>
                        ) : <span className="text-xs text-subtle">—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {canWork && (
              <details className="mt-4 rounded-xl border border-line p-4" open={quoteRows.length === 0 && appointedIds.length > 0}>
                <summary className="cursor-pointer text-sm font-semibold text-brand">Prepare quote</summary>
                <div className="mt-3">
                  <QuoteForm
                    action={saveQuote}
                    hidden={{ requestId: req.id }}
                    insurers={appointedIds.map((i) => ({ id: i, name: orgNames.get(i) ?? "Insurer" }))}
                    versions={versions}
                    risk={risk}
                  />
                </div>
              </details>
            )}

            {liveQuotes.length > 0 && (
              <div className="mt-5 rounded-xl bg-mist p-4">
                <h3 className="font-semibold text-ink">Customer comparison preview</h3>
                <p className="text-sm text-muted">{comparisonSummary(comparison)} {comparison.disclaimer}</p>
                <ol className="mt-3 space-y-2">
                  {comparison.ranked.map((r, i) => (
                    <li key={r.quote.id} className="rounded-lg bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">{i + 1}. {r.quote.insurerName} · {formatGHS(r.quote.premium)}</p>
                        <div className="flex flex-wrap gap-1">
                          <StatusPill meta={QUOTE_STATUS[r.quote.status]} />
                          {r.labels.map((l) => <Pill key={l} tone="ok">{LABELS[l]}</Pill>)}
                        </div>
                      </div>
                      {r.reasons.length > 0 && <p className="mt-1 text-xs text-muted">{r.reasons.join(" ")}</p>}
                    </li>
                  ))}
                </ol>
                {canWork && (
                  <ActionForm action={sendQuotesToCustomer} submitLabel="Send quotes to customer" className="mt-4 space-y-3">
                    <input type="hidden" name="requestId" value={req.id} />
                    <Field label="Message to the customer (optional)" htmlFor="sq-msg">
                      <Textarea id="sq-msg" name="message" rows={2} className="min-h-16 text-sm" placeholder="Your quotes are ready. I'd suggest checking the windscreen limit…" />
                    </Field>
                  </ActionForm>
                )}
              </div>
            )}
          </Section>

          {/* Messages ---------------------------------------------------------- */}
          <Section id="messages" title="Messages" description="Threaded with the customer. Internal notes are never shown to customers.">
            <RealtimeRefresh table="request_messages" filter={`request_id=eq.${req.id}`} channel={`msg-${req.id}`} />
            <ol className="mt-3 max-h-[480px] space-y-3 overflow-y-auto">
              {(messages.data ?? []).length === 0 && <Empty>No messages yet.</Empty>}
              {(messages.data ?? []).map((m) => {
                const mine = m.sender_party !== "customer";
                const who = m.sender_party === "customer" ? fullName(customer) : m.sender_id ? (members.get(m.sender_id)?.name ?? humanize(m.sender_party)) : humanize(m.sender_party);
                return (
                  <li key={m.id} className={mine ? "flex flex-col items-end" : "flex flex-col items-start"}>
                    <div className={m.internal ? "max-w-[85%] rounded-2xl border border-gold/50 bg-amber-bg px-4 py-2.5 text-sm text-ink" : mine ? "max-w-[85%] rounded-2xl bg-brand px-4 py-2.5 text-sm text-white" : "max-w-[85%] rounded-2xl bg-mist px-4 py-2.5 text-sm text-ink"}>
                      {m.internal && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber">Internal note</p>}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-subtle">{who} · {formatDateTime(m.created_at)}</p>
                  </li>
                );
              })}
            </ol>
            {canWork && (
              <ActionForm action={sendMessage} submitLabel="Send" resetOnSuccess className="mt-4 space-y-2">
                <input type="hidden" name="requestId" value={req.id} />
                <label htmlFor="msg-body" className="sr-only">Message</label>
                <Textarea id="msg-body" name="body" rows={3} required placeholder={`Message ${fullName(customer)}…`} className="min-h-20 text-sm" />
                <Checkbox name="internal" label="Internal note (team only)" />
              </ActionForm>
            )}
          </Section>

          {/* Documents --------------------------------------------------------- */}
          <Section title="Documents" description="An upload is not insurer notification until you record delivery.">
            {(documents.data ?? []).length === 0 ? (
              <Empty>No documents yet.</Empty>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {(documents.data ?? []).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      {urls.get(d.storage_path) ? (
                        <a href={urls.get(d.storage_path) ?? undefined} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand">{d.file_name}</a>
                      ) : <span className="font-medium text-ink">{d.file_name}</span>}
                      <p className="text-xs text-muted">
                        {humanize(d.kind)} · from {d.uploaded_by_party} · {formatDateTime(d.created_at)}
                        {d.size_bytes ? ` · ${Math.round(d.size_bytes / 1024)} KB` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {d.verified ? <Pill tone="ok">Verified</Pill> : <Pill tone="wait">Not verified</Pill>}
                        {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered to insurer {formatDate(d.delivered_to_insurer_at)}</Pill> : <Pill>Not delivered to insurer</Pill>}
                      </div>
                    </div>
                    {canWork && (
                      <div className="flex gap-2">
                        {!d.verified && (
                          <ActionForm action={documentAction} submitLabel="Verify" variant="secondary" inline>
                            <input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="op" value="verify" />
                          </ActionForm>
                        )}
                        {!d.delivered_to_insurer_at && (
                          <ActionForm action={documentAction} submitLabel="Mark delivered to insurer" variant="outline" inline>
                            <input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="op" value="deliver" />
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Timeline ---------------------------------------------------------- */}
          <Section title="Timeline" description="Everything that happened on this request, including internal events.">
            {(events.data ?? []).length === 0 ? <Empty>No events yet.</Empty> : (
              <Timeline
                steps={(events.data ?? []).map((e, i, arr) => ({
                  state: i === arr.length - 1 ? "current" : "done",
                  title: (
                    <span>
                      {e.event === "status_changed" && e.to_status ? `Status: ${REQUEST_STATUS[e.to_status].label}` : e.event === "created" ? "Request created" : humanize(e.event)}
                      {!e.visible_to_customer && <span className="ml-2 rounded bg-mist px-1.5 py-0.5 text-[11px] font-medium text-muted">Internal</span>}
                    </span>
                  ),
                  detail: (
                    <>
                      {formatDateTime(e.created_at)} · {e.actor_id ? (members.get(e.actor_id)?.name ?? humanize(e.actor_party)) : humanize(e.actor_party)}
                      {e.note && <p className="mt-0.5 text-ink-2">{e.note}</p>}
                    </>
                  ),
                }))}
              />
            )}
          </Section>
        </div>

        {/* Sidebar ----------------------------------------------------------- */}
        <aside className="space-y-6">
          <Section title="Owner">
            <KV label="Team">{req.team ?? "—"}</KV>
            <KV label="Assigned to">{assignee?.name ?? "Unassigned"}</KV>
            {canWork && (
              <ActionForm action={assignRequest} submitLabel={ctx.isSupervisor ? "Assign" : "Take ownership"} className="mt-3 space-y-3">
                <input type="hidden" name="requestId" value={req.id} />
                {ctx.isSupervisor ? (
                  <>
                    <Field label="Team member" htmlFor="as-user">
                      <Select id="as-user" name="assignee" defaultValue={req.assigned_to ?? ""} className="h-10 text-sm">
                        <option value="">Unassigned</option>
                        {team.filter((m) => ["owner", "admin", "supervisor", "adviser"].includes(m.role)).map((m) => (
                          <option key={m.userId} value={m.userId}>{m.name}{m.team ? ` · ${m.team}` : ""}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Team" htmlFor="as-team">
                      <Input id="as-team" name="team" list="team-list" defaultValue={req.team ?? ""} className="h-10 text-sm" />
                      <datalist id="team-list">{teamsOf(team).map((t) => <option key={t} value={t} />)}</datalist>
                    </Field>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="assignee" value={ctx.userId} />
                    <input type="hidden" name="team" value={ctx.membership.team ?? req.team ?? ""} />
                  </>
                )}
              </ActionForm>
            )}
          </Section>

          <Section title="Customer" actions={<Link href={`/partner/customers/${req.customer_id}`} className="text-sm font-medium text-brand hover:underline">Profile →</Link>}>
            <KV label="Name">{fullName(customer)}</KV>
            <KV label="Email">{customer?.email ?? "—"}</KV>
            <KV label="Phone">{customer?.phone ?? "—"}</KV>
            <KV label="Account">{customer ? humanize(customer.account_type) : "—"}</KV>
            <KV label="Region">{customer?.region ?? "—"}</KV>
            <KV label="KYC (Ghana Card)"><Pill tone={customer?.kyc_status === "verified" ? "ok" : customer?.kyc_status === "rejected" ? "danger" : "wait"}>{humanize(customer?.kyc_status ?? "unverified")}</Pill></KV>
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Consents</p>
              {consents === null ? (
                <p className="mt-1 text-sm text-muted">Consent records are held by the platform and aren't available here right now.</p>
              ) : consents.length === 0 ? (
                <p className="mt-1 text-sm text-amber">No consent records found.</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {consents.map((c) => <li key={c.type}><Pill tone={c.granted ? "ok" : "danger"}>{c.granted ? "✓" : "✕"} {humanize(c.type)}</Pill></li>)}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Risk details" description={category?.name}>
            {schema.length === 0 && Object.keys(risk).length === 0 ? <Empty>No risk data captured.</Empty> : (
              <>
                {schema.map((f) => <KV key={f.key} label={f.label}>{riskDisplay(f, risk[f.key])}</KV>)}
                {Object.keys(risk).filter((k) => !schema.some((f) => f.key === k)).map((k) => <KV key={k} label={humanize(k)}>{String(risk[k])}</KV>)}
              </>
            )}
          </Section>

          <Section title="Fulfilment">
            <KV label="Application">{application ? APPLICATION_LABEL[application.status] : "Not started"}</KV>
            <KV label="Payment">{payment ? <>{PAYMENT_STATUS[payment.status].label} · {formatGHS(Number(payment.amount))}</> : "—"}</KV>
            <KV label="Policy">{policy ? <>{POLICY_STATUS[policy.status].label}{policy.policy_number ? ` · ${policy.policy_number}` : ""}</> : "—"}</KV>
            <FulfilmentCard done={checkpoints} demo={ctx.isDemo} className="mt-3 p-4" />
            {req.status === "policy_documents" && canWork && (
              policy?.status === "active" ? (
                <ActionForm action={deliverPolicyDocuments} submitLabel="Deliver policy documents" className="mt-3" confirm="Confirm the customer has their schedule and certificate? This completes the request.">
                  <input type="hidden" name="requestId" value={req.id} />
                </ActionForm>
              ) : (
                <p className="mt-3 text-sm text-muted">Waiting for the insurer to issue the policy. You can deliver documents once it's active.</p>
              )
            )}
          </Section>

          {ctx.isSupervisor && !["completed", "cancelled", "closed_no_cover"].includes(req.status) && (
            <Section title="Change broker of record" description="Supervisors only.">
              <p className="text-sm text-muted">
                One broker of record per request. The customer must be shown and acknowledge the new broker
                (a <span className="font-medium">broker change disclosure</span>) before the request can move. Current: {currentBrokerName}.
              </p>
              {changeDisclosures.length > 0 && (
                <div className="mt-3 space-y-2">
                  {changeDisclosures.map((d) => (
                    <ActionForm key={d.broker_org_id} action={completeBrokerChange} submitLabel={`Hand over to ${(brokerDir.data ?? []).find((b) => b.id === d.broker_org_id)?.name ?? "new broker"}`} variant="secondary" confirm="Hand this request to the new broker of record?">
                      <input type="hidden" name="requestId" value={req.id} />
                      <input type="hidden" name="targetOrgId" value={d.broker_org_id} />
                      <p className="text-xs text-brand">✓ Customer acknowledged on {formatDate(d.acknowledged_at)}</p>
                    </ActionForm>
                  ))}
                </div>
              )}
              {(brokerDir.data ?? []).length > 0 && (
                <ActionForm action={requestBrokerChange} submitLabel="Ask customer to confirm" variant="outline" className="mt-3 space-y-3">
                  <input type="hidden" name="requestId" value={req.id} />
                  <Field label="New broker" htmlFor="bc-org">
                    <Select id="bc-org" name="targetOrgId" className="h-10 text-sm">
                      {(brokerDir.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Reason (shown to the customer)" htmlFor="bc-reason">
                    <Textarea id="bc-reason" name="reason" rows={2} className="min-h-16 text-sm" required />
                  </Field>
                  <p className="text-xs text-muted">Disclosure preview: {buildDisclosure({ broker: { name: "the new broker" } })}</p>
                </ActionForm>
              )}
            </Section>
          )}
        </aside>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

