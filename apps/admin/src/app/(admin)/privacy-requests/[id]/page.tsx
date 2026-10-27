import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, StatusPill, Timeline } from "@im/ui";
import { DELETION_RETAINED, PRIVACY_REQUEST_TYPES, PRIVACY_STATUS, describeRetainedRecords, privacyActionsFor, privacyDeadline } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { addNote, approveRequest, closeRequest, fulfilDeletion, fulfilRequest, generateExport, refuseRequest, verifyIdentity } from "../actions";
import { DeletionPreview } from "./deletion-preview";

export default function PrivacyRequestDetailPage({ params }: PageProps<"/privacy-requests/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading privacy request…" />}>
      <Detail params={params} />
    </Suspense>
  );
}

const sel = "mt-1.5 block h-10 w-full rounded-field border border-line bg-white px-3 text-sm";
const area = "mt-1.5 block min-h-20 w-full rounded-field border border-line p-3 text-sm";

const METHODS = [
  { value: "signed_in_session", label: "Signed-in session (request made from their verified account)" },
  { value: "ghana_card", label: "Ghana Card checked" },
  { value: "video_call", label: "Video call" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other (explain in the note)" },
];

async function Detail({ params }: Pick<PageProps<"/privacy-requests/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("privacy_requests").select("*").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: events }, { data: others }, { data: profile }] = await Promise.all([
    supabase.from("privacy_request_events").select("*").eq("request_id", id).order("created_at"),
    supabase.from("privacy_requests").select("id, reference, type, status, created_at").eq("user_id", r.user_id).neq("id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("profiles").select("full_name, email, phone, kyc_status, anonymised_at, created_at").eq("id", r.user_id).maybeSingle(),
  ]);
  const people = await profileMap(supabase, [r.user_id, r.identity_verified_by, r.decided_by, r.closed_by, ...(events ?? []).map((e) => e.actor_id)]);
  const canAct = can(staff.roles, "privacy");
  const actions = privacyActionsFor(r.type, r.status);
  const meta = PRIVACY_REQUEST_TYPES[r.type];
  const deadline = privacyDeadline(r);
  const summary = r.anonymisation_summary as { retained?: Record<string, number>; scrubbed?: Record<string, number> } | null;
  const fields = { requestId: r.id };

  return (
    <>
      <Breadcrumb items={[{ label: "Privacy requests", href: "/privacy-requests" }, { label: r.reference }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{r.reference} <StatusPill meta={PRIVACY_STATUS[r.status]} /></span>}
        description={`${meta.label} · received ${formatDateTime(r.created_at)} via ${r.channel}`}
        actions={
          <>
            {actions.includes("refuse") && (
              <ConfirmAction
                action={refuseRequest}
                fields={fields}
                label="Refuse"
                title={`Refuse ${r.reference}`}
                confirmLabel="Refuse request"
                reasonLabel="Reason (the customer is told this)"
                disabled={!canAct}
                body="Refuse only with a lawful reason (for example identity could not be confirmed, or the data must be kept by law). The reason is shown to the customer."
              />
            )}
            {actions.includes("close") && (
              <ConfirmAction action={closeRequest} fields={fields} label="Close" title={`Close ${r.reference}`} confirmLabel="Close" variant="primary" requireReason={false} disabled={!canAct} body="Closing ends the request. Exports stop being downloadable once they expire." />
            )}
          </>
        }
      />
      <ReadOnlyBanner show={!canAct} />
      {deadline.overdue && <Notice tone="danger" className="mb-5">This request is past its due date ({formatDateTime(r.due_at)}).</Notice>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Request">
            <KeyValues
              cols={3}
              items={[
                { label: "Person", value: <Link className="text-brand hover:underline" href={`/users/${r.user_id}`}>{personName(people.get(r.user_id), "Deleted customer")}</Link> },
                { label: "Account", value: profile?.anonymised_at ? `Anonymised ${formatDateTime(profile.anonymised_at)}` : profile?.email ?? "—" },
                { label: "KYC", value: profile?.kyc_status ?? "—" },
                { label: "Due", value: <span className={deadline.overdue ? "text-danger" : ""}>{formatDateTime(r.due_at)}{deadline.daysLeft !== null ? ` (${deadline.label})` : ""}</span> },
                { label: "Identity verified", value: r.identity_verified_at ? `${formatDateTime(r.identity_verified_at)} · ${r.identity_method?.replace(/_/g, " ")}` : "Not yet" },
                { label: "Decision", value: r.decision ? `${r.decision} ${formatDateTime(r.decided_at)}` : "—" },
                { label: "Export", value: r.export_generated_at ? `${formatDateTime(r.export_generated_at)} · ${((r.export_bytes ?? 0) / 1024).toFixed(1)} KB` : "—" },
                { label: "Export expires", value: formatDateTime(r.export_expires_at) },
                { label: "Downloads", value: String(r.export_download_count) },
              ]}
            />
            <div className="mt-5 space-y-3 text-sm">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Customer&apos;s note</p>
                <p className="mt-1 whitespace-pre-line text-ink-2">{r.note ?? "—"}</p>
              </div>
              {r.decision_reason && (
                <div><p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Decision reason</p><p className="mt-1 text-ink-2">{r.decision_reason}</p></div>
              )}
              {r.fulfilment_note && (
                <div><p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Shown to the customer</p><p className="mt-1 text-ink-2">{r.fulfilment_note}</p></div>
              )}
            </div>
          </Panel>

          {actions.includes("verify_identity") && (
            <Panel title="1. Verify identity" description="Confirm the request really comes from this person before sharing or changing anything.">
              <ActionForm action={verifyIdentity} submitLabel="Identity verified" readOnly={!canAct}>
                <input type="hidden" name="requestId" value={r.id} />
                <label className="block text-sm font-medium text-ink-2">
                  How was identity verified?
                  <select name="method" required className={sel} defaultValue="signed_in_session">
                    {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-ink-2">
                  Internal note (optional)
                  <textarea name="reason" maxLength={2000} className={area} />
                </label>
              </ActionForm>
            </Panel>
          )}

          {actions.includes("generate_export") && (
            <Panel title="Generate the export" description="Builds a JSON file of everything Covva holds about this person (secrets, internal notes and staff names removed) and stores it privately. The customer downloads it from their account; the link expires.">
              <ActionForm action={generateExport} submitLabel={r.export_path ? "Generate a fresh export" : "Generate export"} readOnly={!canAct}>
                <input type="hidden" name="requestId" value={r.id} />
              </ActionForm>
            </Panel>
          )}

          {actions.includes("approve") && (
            <Panel title="2. Approve" description={r.type === "deletion" ? "Check nothing stops the deletion (open claims, disputes, legal holds). The anonymisation runs in the next step." : "Approve the request, then carry it out."}>
              <ActionForm action={approveRequest} submitLabel="Approve" readOnly={!canAct}>
                <input type="hidden" name="requestId" value={r.id} />
                <label className="block text-sm font-medium text-ink-2">
                  Internal note (optional)
                  <textarea name="reason" maxLength={2000} className={area} />
                </label>
              </ActionForm>
            </Panel>
          )}

          {r.type === "deletion" && ["submitted", "identity_verified", "approved"].includes(r.status) && (
            <Panel title={actions.includes("fulfil_deletion") ? "3. Fulfil the deletion" : "Deletion preview"} description="Deletion is anonymisation: contact details, chats, drafts, leads and saved cards are erased; insurance records are kept untouched with a retention reason.">
              <div className="space-y-5">
                <DeletionPreview requestId={r.id} disabled={!canAct} />
                {actions.includes("fulfil_deletion") && (
                  <ConfirmAction
                    action={fulfilDeletion}
                    fields={fields}
                    label="Run the anonymisation"
                    title={`Anonymise the data for ${r.reference}`}
                    confirmLabel="Anonymise now"
                    confirmWord="ANONYMISE"
                    requireReason={false}
                    disabled={!canAct}
                    triggerVariant="danger"
                    body="This cannot be undone. Erased data is gone; retained insurance records stay. The sign-in is closed and a confirmation is emailed to the address on file before it is erased."
                  />
                )}
              </div>
            </Panel>
          )}

          {actions.includes("fulfil") && (
            <Panel title="3. Mark as done" description={r.type === "correction" ? "Make the correction first (Users → profile, or ask the broker / insurer for records they hold), then describe what changed." : "Describe what you stopped, or why some processing continues."}>
              <ActionForm action={fulfilRequest} submitLabel="Mark as done" readOnly={!canAct}>
                <input type="hidden" name="requestId" value={r.id} />
                <label className="block text-sm font-medium text-ink-2">
                  What was done (shown to the customer)
                  <textarea name="reason" required minLength={5} maxLength={2000} className={area} />
                </label>
              </ActionForm>
            </Panel>
          )}

          {r.type === "deletion" && r.retention_note && (
            <Panel title="What was erased and retained">
              <p className="text-sm text-ink-2">{r.retention_note}</p>
              {summary?.retained && <p className="mt-2 text-sm text-muted">Retained: {describeRetainedRecords(summary.retained).join(", ") || "nothing"}.</p>}
              {summary?.scrubbed && (
                <p className="mt-1 text-sm text-muted">
                  Erased: {Object.entries(summary.scrubbed).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`).join(", ")}.
                </p>
              )}
              <details className="mt-3 text-[13px] text-muted">
                <summary className="cursor-pointer font-medium text-brand">Why records are retained</summary>
                <ul className="mt-2 space-y-1">{DELETION_RETAINED.map((e) => <li key={e.table}><span className="font-medium text-ink-2">{e.table}:</span> {e.reason}</li>)}</ul>
              </details>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Timeline">
            <Timeline
              steps={(events ?? []).map((e) => ({
                state: "done" as const,
                title: e.to_status ? PRIVACY_STATUS[e.to_status].label : e.event.replace(/_/g, " "),
                detail: (
                  <span>
                    {formatDateTime(e.created_at)} · {e.actor_party}
                    {e.actor_id ? ` · ${personName(people.get(e.actor_id), "user")}` : ""}
                    {!e.visible_to_customer && " · internal"}
                    {e.note && <span className="block text-ink-2">{e.note}</span>}
                  </span>
                ),
              }))}
            />
            {!events?.length && <p className="text-sm text-muted">No events.</p>}
          </Panel>
          <Panel title="Internal note">
            <ActionForm action={addNote} submitLabel="Add note" readOnly={!canAct}>
              <input type="hidden" name="requestId" value={r.id} />
              <textarea name="reason" required minLength={5} maxLength={2000} className={area} aria-label="Internal note" />
            </ActionForm>
          </Panel>
          {(others ?? []).length > 0 && (
            <Panel title="Other requests from this person">
              <ul className="space-y-1.5 text-sm">
                {(others ?? []).map((o) => (
                  <li key={o.id}>
                    <Link href={`/privacy-requests/${o.id}`} className="font-medium text-brand hover:underline">{o.reference}</Link>{" "}
                    <span className="text-muted">{PRIVACY_REQUEST_TYPES[o.type].label} · {PRIVACY_STATUS[o.status].label}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
