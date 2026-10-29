import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Download, ExternalLink, ListChecks, Mail, Paperclip, Phone, Pin, Send, StickyNote, XCircle } from "lucide-react";
import { Avatar, Field, Input, Notice, Pill, Select, Textarea } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { canMoveStage, CRM_PIPELINE_STAGES, crmStageLabel, nextStages, taskDueState, type CrmStage } from "@im/core";
import { attachmentUrl, contactOf, requireCrm, staffDirectory } from "@/lib/crm";
import { isUuid, orgMap, profileMap, personName } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction, ToggleForm } from "@/components/ui/forms";
import { AccountFields } from "../AccountFields";
import { addMeeting, addNote, addTask, assignOwner, moveStage, pinNote, startAssistedOnboarding, toggleTask, updateAccount, uploadAttachment } from "../actions";
import { CRM_BASE, KIND_LABEL, SIZE_FMT, SOURCE_LABEL, STAGE_LABEL, STAGE_TONE } from "../meta";

export default function AccountPage({ params }: PageProps<"/partners/crm/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading account…" rows={10} />}>
      <AccountDetail params={params} />
    </Suspense>
  );
}

async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { actor, supabase } = await requireCrm();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data: acc } = await supabase.from("crm_accounts").select("*").eq("id", id).maybeSingle();
  if (!acc) notFound();

  const [{ data: notes }, { data: tasks }, { data: meetings }, { data: attachments }, { data: events }, staff, orgs] = await Promise.all([
    supabase.from("crm_notes").select("*").eq("account_id", id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("crm_tasks").select("*").eq("account_id", id).order("done_at", { ascending: true, nullsFirst: true }).order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("crm_meetings").select("*").eq("account_id", id).order("starts_at", { ascending: false }).limit(100),
    supabase.from("crm_attachments").select("*").eq("account_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("crm_stage_events").select("*").eq("account_id", id).order("at", { ascending: false }).limit(50),
    staffDirectory(supabase, actor.staff.orgId),
    orgMap(supabase),
  ]);
  const people = await profileMap(supabase, [
    ...(notes ?? []).map((n) => n.author_id),
    ...(tasks ?? []).map((t) => t.assignee_id),
    ...(events ?? []).map((e) => e.by),
    ...(attachments ?? []).map((a) => a.uploaded_by),
    ...(meetings ?? []).map((m) => m.created_by),
  ]);
  const who = (uid: string | null) => (uid ? personName(people.get(uid), "staff") : "System");
  const links = await Promise.all((attachments ?? []).map(async (a) => [a.id, await attachmentUrl(supabase, a.storage_path)] as const));
  const linkById = new Map(links);

  const stage = acc.stage as CrmStage;
  const contact = contactOf(acc);
  const owner = acc.owner_user_id ? staff.find((m) => m.userId === acc.owner_user_id) : undefined;
  const org = acc.org_id ? orgs.get(acc.org_id) : undefined;
  const canAct = actor.canWrite;
  const openTasks = (tasks ?? []).filter((t) => !t.done_at);
  const doneTasks = (tasks ?? []).filter((t) => t.done_at);
  const now = new Date();

  return (
    <div className="pb-24 md:pb-0">
      <Breadcrumb items={[{ label: "Partnerships CRM", href: CRM_BASE }, { label: acc.name }]} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {acc.name}
            <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>
            <Pill tone="neutral">{KIND_LABEL[acc.kind as keyof typeof KIND_LABEL] ?? acc.kind}</Pill>
          </span>
        }
        description={`${SOURCE_LABEL[acc.source as keyof typeof SOURCE_LABEL] ?? acc.source}${acc.region ? ` · ${acc.region}` : ""} · ${owner ? `Owned by ${owner.name}` : "No owner yet"} · Created ${formatDate(acc.created_at)}`}
        actions={
          <>
            {contact.phone && <a href={`tel:${contact.phone}`} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-mist"><Phone className="size-4" aria-hidden /> Call</a>}
            {contact.email && <a href={`mailto:${contact.email}`} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-mist"><Mail className="size-4" aria-hidden /> Email</a>}
          </>
        }
      />
      <ReadOnlyBanner show={!canAct} />

      {/* Stage stepper + moves */}
      <Panel id="stage" title="Pipeline stage" description={acc.stage === "lost" ? `Lost: ${acc.lost_reason ?? "no reason recorded"}` : "Move one step at a time; a note is kept with every move."} className="mb-6 scroll-mt-20">
        <ol className="flex flex-wrap gap-1.5" aria-label="Stages">
          {CRM_PIPELINE_STAGES.map((s, i) => {
            const cur = CRM_PIPELINE_STAGES.indexOf(stage as (typeof CRM_PIPELINE_STAGES)[number]);
            const state = stage === "lost" ? "upcoming" : i < cur ? "done" : i === cur ? "current" : "upcoming";
            return (
              <li
                key={s}
                aria-current={state === "current" ? "step" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-sm px-3 text-xs font-semibold ${state === "current" ? "bg-brand text-white" : state === "done" ? "bg-mint text-brand-deep" : "bg-mist text-muted"}`}
              >
                {state === "done" && <Check className="size-3.5" aria-hidden />}
                {crmStageLabel(s)}
              </li>
            );
          })}
          {stage === "lost" && <li aria-current="step" className="flex h-9 items-center rounded-sm bg-danger px-3 text-xs font-semibold text-white">Lost</li>}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {nextStages(stage).map((to) => {
            const check = canMoveStage(stage, to, { hasOrg: !!acc.org_id });
            const forward = to !== "lost" && stage !== "lost" && CRM_PIPELINE_STAGES.indexOf(to as never) > CRM_PIPELINE_STAGES.indexOf(stage as never);
            return (
              <ConfirmAction
                key={to}
                action={moveStage}
                fields={{ accountId: acc.id, to }}
                label={
                  to === "lost" ? (
                    <><XCircle className="size-4" aria-hidden /> Mark lost</>
                  ) : forward || stage === "lost" ? (
                    <>{crmStageLabel(to)} <ArrowRight className="size-4" aria-hidden /></>
                  ) : (
                    <><ArrowLeft className="size-4" aria-hidden /> Back to {crmStageLabel(to)}</>
                  )
                }
                title={to === "lost" ? `Mark ${acc.name} as lost` : `Move ${acc.name} to ${crmStageLabel(to)}`}
                confirmLabel={to === "lost" ? "Mark lost" : `Move to ${crmStageLabel(to)}`}
                variant={to === "lost" ? "danger" : "primary"}
                triggerVariant={to === "lost" ? "outline" : forward ? "primary" : "outline"}
                requireReason={to === "lost"}
                reasonLabel="Why was this account lost? (recorded)"
                disabled={!canAct || !check.ok}
                size="md"
                body={!check.ok ? check.reason : to === "live" ? `Going live links the partner to ${org?.name ?? "its organisation"} and stamps the go-live date.` : undefined}
              >
                {to !== "lost" && (
                  <Field label="Note (optional)" htmlFor={`note-${to}`}>
                    <Textarea id={`note-${to}`} name="note" maxLength={2000} className="min-h-20" placeholder="What happened? Next step?" />
                  </Field>
                )}
              </ConfirmAction>
            );
          })}
          {stage !== "live" && !acc.org_id && stage === "onboarding" && <p className="w-full text-xs text-amber">Link the organisation (Details panel) before the account can go live.</p>}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* Notes */}
          <Panel id="note" title="Notes" description="Timeline of calls, emails and context. Pinned notes stay on top." className="scroll-mt-20">
            <ActionForm action={addNote} submitLabel={<><StickyNote className="size-4" aria-hidden /> Add note</>} readOnly={!canAct} audited={false} className="mb-5">
              <input type="hidden" name="accountId" value={acc.id} />
              <Textarea name="body" required maxLength={8000} className="min-h-24" placeholder="Spoke to the head of partnerships; they want motor and travel first…" aria-label="Note" />
              <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="pinned" className="size-4 accent-brand" /> Pin this note</label>
            </ActionForm>
            {notes?.length ? (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className={`rounded-xl border p-3 ${n.pinned ? "border-brand/40 bg-mint/30" : "border-line"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted">
                        {n.pinned && <Pin className="mr-1 inline size-3 text-brand" aria-label="Pinned" />}
                        <span className="font-medium text-ink-2">{n.author_id ? who(n.author_id) : "Website / lead message"}</span> · {formatDateTime(n.created_at)}
                      </p>
                      <ActionForm action={pinNote} inline submitLabel={n.pinned ? "Unpin" : "Pin"} submitVariant="ghost" readOnly={!canAct}>
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="value" value={n.pinned ? "false" : "true"} />
                      </ActionForm>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No notes yet.</p>
            )}
          </Panel>

          {/* Tasks */}
          <Panel id="task" title={<span className="flex items-center gap-2">Tasks <Pill tone={openTasks.some((t) => taskDueState(t.due_at, now) === "overdue") ? "danger" : "neutral"}>{openTasks.length} open</Pill></span>} description="Follow-ups with due dates. Due and overdue tasks are reminded daily." className="scroll-mt-20">
            <ActionForm action={addTask} submitLabel={<><ListChecks className="size-4" aria-hidden /> Add task</>} readOnly={!canAct} audited={false} className="mb-5">
              <input type="hidden" name="accountId" value={acc.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Task" htmlFor="task-title" className="sm:col-span-3">
                  <Input id="task-title" name="title" required maxLength={300} placeholder="Send proposal deck" />
                </Field>
                <Field label="Due" htmlFor="task-due">
                  <Input id="task-due" name="due_at" type="datetime-local" />
                </Field>
                <Field label="Assignee" htmlFor="task-assignee" className="sm:col-span-2">
                  <Select id="task-assignee" name="assignee_id" defaultValue={acc.owner_user_id ?? actor.staff.userId}>
                    {staff.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === actor.staff.userId ? " (me)" : ""}</option>)}
                  </Select>
                </Field>
              </div>
            </ActionForm>
            <ul className="divide-y divide-line">
              {[...openTasks, ...doneTasks].map((t) => {
                const due = taskDueState(t.due_at, now);
                return (
                  <li key={t.id} className="flex min-h-12 items-center gap-3 py-2">
                    <ToggleForm action={toggleTask} fields={{ taskId: t.id }} checked={!!t.done_at} label={`Mark "${t.title}" ${t.done_at ? "not done" : "done"}`} disabled={!canAct} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${t.done_at ? "text-muted line-through" : "font-medium text-ink"}`}>{t.title}</p>
                      <p className="text-xs text-muted">
                        {who(t.assignee_id)}
                        {t.due_at && (
                          <span className={due === "overdue" && !t.done_at ? "text-danger" : due === "today" && !t.done_at ? "text-amber" : ""}> · due {formatDateTime(t.due_at)}{due === "overdue" && !t.done_at ? " (overdue)" : ""}</span>
                        )}
                        {t.done_at && ` · done ${formatDateTime(t.done_at)}`}
                      </p>
                    </div>
                  </li>
                );
              })}
              {!tasks?.length && <li className="py-2 text-sm text-muted">No tasks yet.</li>}
            </ul>
          </Panel>

          {/* Meetings */}
          <Panel id="meeting" title="Meetings" description="Record meetings and what was agreed." className="scroll-mt-20">
            <ActionForm action={addMeeting} submitLabel={<><CalendarDays className="size-4" aria-hidden /> Record meeting</>} readOnly={!canAct} audited={false} className="mb-5">
              <input type="hidden" name="accountId" value={acc.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts" htmlFor="m-start"><Input id="m-start" name="starts_at" type="datetime-local" required /></Field>
                <Field label="Ends" htmlFor="m-end"><Input id="m-end" name="ends_at" type="datetime-local" /></Field>
                <Field label="Location" htmlFor="m-loc"><Input id="m-loc" name="location" maxLength={300} placeholder="Their office, Airport City / Google Meet" /></Field>
                <Field label="Attendees" htmlFor="m-att" hint="Comma separated"><Input id="m-att" name="attendees" maxLength={1000} /></Field>
                <Field label="Summary" htmlFor="m-sum" className="sm:col-span-2"><Textarea id="m-sum" name="summary" maxLength={4000} className="min-h-20" /></Field>
              </div>
            </ActionForm>
            {meetings?.length ? (
              <ul className="space-y-3">
                {meetings.map((m) => (
                  <li key={m.id} className="rounded-xl border border-line p-3 text-sm">
                    <p className="font-medium text-ink">{formatDateTime(m.starts_at)}{m.ends_at ? ` – ${formatDateTime(m.ends_at)}` : ""}{m.location ? ` · ${m.location}` : ""}</p>
                    {Array.isArray(m.attendees) && m.attendees.length > 0 && <p className="mt-0.5 text-xs text-muted">With {(m.attendees as string[]).join(", ")}</p>}
                    {m.summary && <p className="mt-1.5 whitespace-pre-line text-ink-2">{m.summary}</p>}
                    <p className="mt-1 text-xs text-subtle">Recorded by {who(m.created_by)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No meetings recorded.</p>
            )}
          </Panel>

          {/* Attachments */}
          <Panel id="files" title="Attachments" description="Proposals, agreements and licences (private storage; links expire after 10 minutes)." className="scroll-mt-20">
            <ActionForm action={uploadAttachment} submitLabel={<><Paperclip className="size-4" aria-hidden /> Upload</>} readOnly={!canAct} audited={false} className="mb-5">
              <input type="hidden" name="accountId" value={acc.id} />
              <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx" aria-label="File" className="block w-full text-sm text-ink-2 file:mr-3 file:h-10 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:text-sm file:font-medium file:text-ink" />
            </ActionForm>
            {attachments?.length ? (
              <ul className="divide-y divide-line">
                {attachments.map((a) => (
                  <li key={a.id} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{a.name}</p>
                      <p className="text-xs text-muted">{SIZE_FMT(a.size_bytes)} · {who(a.uploaded_by)} · {formatDateTime(a.created_at)}</p>
                    </div>
                    {linkById.get(a.id) ? (
                      <a href={linkById.get(a.id)!} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md border border-line px-3 text-sm text-brand hover:bg-mist"><Download className="size-4" aria-hidden /> Download</a>
                    ) : (
                      <span className="text-xs text-subtle">Unavailable</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No attachments.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {/* Contact & owner */}
          <Panel title="Contact">
            <KeyValues
              items={[
                { label: "Name", value: contact.name ? `${contact.name}${contact.title ? `, ${contact.title}` : ""}` : "—" },
                { label: "Email", value: contact.email ? <a href={`mailto:${contact.email}`} className="text-brand hover:underline">{contact.email}</a> : "—" },
                { label: "Phone", value: contact.phone ? <a href={`tel:${contact.phone}`} className="text-brand hover:underline">{contact.phone}</a> : "—" },
                { label: "Estimated value", value: acc.estimated_value != null ? `GH₵ ${Number(acc.estimated_value).toLocaleString("en-GH")}` : "—" },
                { label: "Expected go-live", value: formatDate(acc.expected_go_live) },
                { label: "Tags", value: acc.tags.length ? acc.tags.join(", ") : "—" },
              ]}
            />
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Owner</p>
              <div className="flex items-center gap-3">
                {owner && <Avatar name={owner.name} size={32} />}
                <ActionForm action={assignOwner} inline submitLabel="Assign" submitVariant="secondary" readOnly={!canAct}>
                  <input type="hidden" name="accountId" value={acc.id} />
                  <select name="owner_user_id" defaultValue={acc.owner_user_id ?? ""} aria-label="Owner" className="h-10 max-w-48 rounded-md border border-line bg-white px-2 text-sm">
                    <option value="">Unassigned</option>
                    {staff.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === actor.staff.userId ? " (me)" : ""}</option>)}
                  </select>
                </ActionForm>
              </div>
            </div>
          </Panel>

          {/* Links */}
          <Panel title="Linked records">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Organisation</span>
                {org ? <Link href={`/organisations/${org.id}`} className="inline-flex items-center gap-1 text-brand hover:underline">{org.name} <ExternalLink className="size-3" aria-hidden /></Link> : <span className="text-subtle">Not on the platform yet</span>}
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Application</span>
                {acc.application_id ? <Link href={`/partners/applications/${acc.application_id}`} className="inline-flex items-center gap-1 text-brand hover:underline">Open application <ExternalLink className="size-3" aria-hidden /></Link> : <span className="text-subtle">None</span>}
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Marketing lead</span>
                {acc.lead_id ? <Link href={`/leads?q=${encodeURIComponent(contact.email ?? acc.name)}`} className="inline-flex items-center gap-1 text-brand hover:underline">Open lead <ExternalLink className="size-3" aria-hidden /></Link> : <span className="text-subtle">None</span>}
              </li>
            </ul>
          </Panel>

          {/* Assisted onboarding */}
          <Panel title="Assisted onboarding" description="Pre-fill the partner application from this account and invite the partner to review, confirm and sign.">
            {acc.application_id ? (
              <Notice tone="ok">Application linked. Track it under <Link href={`/partners/applications/${acc.application_id}`} className="underline">Partner applications</Link>; you are notified here when its status changes.</Notice>
            ) : acc.kind !== "insurer" && acc.kind !== "broker" ? (
              <p className="text-sm text-muted">Embedded partners and group schemes are set up as enterprise organisations from <Link href="/organisations/new" className="text-brand hover:underline">Organisations</Link>.</p>
            ) : (
              <ConfirmAction
                action={startAssistedOnboarding}
                fields={{ accountId: acc.id }}
                label={<><Send className="size-4" aria-hidden /> Start assisted onboarding</>}
                title={`Invite ${acc.name} to complete their ${acc.kind} application`}
                confirmLabel="Create application and send invitation"
                variant="primary"
                triggerVariant="primary"
                requireReason={false}
                disabled={!canAct || !contact.email}
                size="md"
                body={contact.email ? `A draft application is created with the details on this account and an invitation is emailed to ${contact.email}. The partner reviews, uploads documents, confirms by one-time code and signs; Covva verifies before anything goes live.` : "Add the contact's email address first."}
              >
                <Field label="Message to the partner (optional)" htmlFor="assisted-msg">
                  <Textarea id="assisted-msg" name="message" maxLength={1000} className="min-h-20" />
                </Field>
              </ConfirmAction>
            )}
          </Panel>

          {/* Details form */}
          <Panel id="details" title="Details" className="scroll-mt-20">
            <ActionForm action={updateAccount} submitLabel="Save changes" readOnly={!canAct}>
              <input type="hidden" name="accountId" value={acc.id} />
              <AccountFields account={acc} staff={staff} orgs={[...orgs.values()]} />
            </ActionForm>
          </Panel>

          {/* Stage history */}
          <Panel title="Stage history">
            {events?.length ? (
              <ol className="space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-3">
                    <p className="font-medium text-ink">{e.from_stage ? `${crmStageLabel(e.from_stage)} → ` : ""}{crmStageLabel(e.to_stage)}</p>
                    <p className="text-xs text-muted">{who(e.by)} · {formatDateTime(e.at)}</p>
                    {e.note && <p className="mt-0.5 text-xs text-ink-2">{e.note}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No stage changes yet.</p>
            )}
          </Panel>
        </div>
      </div>

      {/* Sticky mobile action bar for reps in the field */}
      <nav aria-label="Quick actions" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 backdrop-blur md:hidden">
        {contact.phone ? <a href={`tel:${contact.phone}`} className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink"><Phone className="size-5 text-brand" aria-hidden /> Call</a> : <span className="flex h-16 flex-col items-center justify-center gap-1 text-xs text-subtle"><Phone className="size-5" aria-hidden /> Call</span>}
        {contact.email ? <a href={`mailto:${contact.email}`} className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink"><Mail className="size-5 text-brand" aria-hidden /> Email</a> : <span className="flex h-16 flex-col items-center justify-center gap-1 text-xs text-subtle"><Mail className="size-5" aria-hidden /> Email</span>}
        <a href="#note" className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink"><StickyNote className="size-5 text-brand" aria-hidden /> Note</a>
        <a href="#task" className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink"><ListChecks className="size-5 text-brand" aria-hidden /> Task</a>
        <a href="#stage" className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink"><ArrowRight className="size-5 text-brand" aria-hidden /> Stage</a>
      </nav>
    </div>
  );
}
