import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Checkbox, Field, Notice, Pill, Textarea } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { applicationCompleteness, currentAgreement, agreementText, agreementHash, humanize, type PartnerApplicationInput } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, personName, profileMap } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { NIC_VERIFY_URL } from "@/lib/org-meta";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { approveApplication, rejectApplication, returnApplication, startReview } from "../actions";
import { STATUS_TONE } from "../meta";

export default function ApplicationPage({ params }: PageProps<"/partners/applications/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading application…" />}>
      <Detail params={params} />
    </Suspense>
  );
}

type Contact = { name?: string; email?: string; phone?: string; title?: string };
const contact = (v: unknown): Contact => (v && typeof v === "object" ? (v as Contact) : {});
const contactLine = (c: Contact) => (c.name ? `${c.name}${c.title ? ` (${c.title})` : ""} · ${c.email ?? "no email"}${c.phone ? ` · ${c.phone}` : ""}` : "—");

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: app } = await supabase.from("partner_applications").select("*").eq("id", id).maybeSingle();
  if (!app) notFound();

  const people = await profileMap(supabase, [app.applicant_user_id, app.reviewed_by, app.assisted_by]);
  const applicant = people.get(app.applicant_user_id);
  const completeness = applicationCompleteness(app as unknown as PartnerApplicationInput);
  const docs = (Array.isArray(app.documents) ? app.documents : []) as { kind: string; storage_path: string; name: string; uploaded_at: string }[];
  const signed = docs.length ? await supabase.storage.from("documents").createSignedUrls(docs.map((d) => d.storage_path), 600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = (path: string) => signed.data?.find((s) => s.path === path)?.signedUrl;
  const settlement = (app.settlement_account ?? {}) as Record<string, string>;
  const agreement = (app.agreement ?? {}) as { version?: string; signed_name?: string; signed_title?: string; signed_at?: string; ip?: string; user_agent?: string; hash?: string; provider?: string };
  const currentText = agreement.version ? currentAgreement(app.type as "insurer" | "broker") : null;
  const currentHash = currentText ? await agreementHash(agreementText(currentText)) : null;
  const hashMatches = !!agreement.hash && agreement.hash === currentHash;
  const canDecide = can(staff.roles, "dueDiligence");
  const decidable = app.status === "submitted" || app.status === "in_review";
  const levels = (Array.isArray(app.integration_levels) ? app.integration_levels : []) as { category_slug: string; level: string }[];

  return (
    <>
      <Breadcrumb items={[{ label: "Partner applications", href: "/partners/applications" }, { label: app.company_name ?? "Application" }]} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {app.company_name ?? "Untitled application"}
            <Pill tone={STATUS_TONE[app.status] ?? "neutral"}>{app.status.replace(/_/g, " ")}</Pill>
            <Pill tone="info" className="capitalize">{app.type}</Pill>
          </span>
        }
        description={`Applicant ${personName(applicant)}${applicant?.email ? ` · ${applicant.email}` : ""} · started ${formatDateTime(app.created_at)}${app.submitted_at ? ` · submitted ${formatDateTime(app.submitted_at)}` : ""}`}
        actions={
          app.status === "submitted" && canDecide ? (
            <ActionForm action={startReview} inline submitLabel="Start review" submitVariant="secondary" readOnly={!canDecide}>
              <input type="hidden" name="applicationId" value={app.id} />
            </ActionForm>
          ) : app.created_org_id ? (
            <Link href={`/organisations/${app.created_org_id}`} className="text-sm font-medium text-brand hover:underline">Open organisation →</Link>
          ) : null
        }
      />
      <ReadOnlyBanner show={!canDecide} />
      {app.review_notes && (
        <Notice tone={app.status === "needs_changes" || app.status === "rejected" ? "danger" : "info"} title={`Review notes${app.reviewed_by ? ` · ${personName(people.get(app.reviewed_by), "staff")}` : ""}${app.reviewed_at ? ` · ${formatDateTime(app.reviewed_at)}` : ""}`} className="mb-6">
          <p className="whitespace-pre-line">{app.review_notes}</p>
        </Notice>
      )}
      {!completeness.complete && (
        <Notice tone="wait" title={`${completeness.missing.length} item${completeness.missing.length === 1 ? "" : "s"} incomplete`} className="mb-6">
          <ul className="list-disc pl-5">{completeness.missing.map((m, i) => <li key={i}>{m.label}: {m.reason}</li>)}</ul>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Company">
            <KeyValues
              items={[
                { label: "Trading name", value: app.company_name ?? "—" },
                { label: "Legal name", value: app.legal_name ?? "—" },
                { label: "Registration number", value: app.registration_number ? <span className="font-mono">{app.registration_number}</span> : "—" },
                { label: "Website", value: app.website ? <a href={app.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{app.website}</a> : "—" },
                { label: "Registered address", value: app.address ?? "—" },
                { label: "Region", value: app.region ?? "—" },
              ]}
            />
          </Panel>
          <Panel title="NIC licence" description="Verify on the NIC register before approving. Approval records the licence as verified by you.">
            <KeyValues
              items={[
                { label: "Licence number", value: app.nic_licence_number ? <span className="font-mono">{app.nic_licence_number}</span> : "—" },
                { label: "Class", value: app.nic_licence_class ? humanize(app.nic_licence_class) : "—" },
                { label: "Expires", value: formatDate(app.nic_licence_expires_on) },
                {
                  label: "NIC register",
                  value: (
                    <a href={NIC_VERIFY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                      Open the register <ExternalLink className="size-3" />
                    </a>
                  ),
                },
              ]}
            />
          </Panel>
          <Panel title="Contacts">
            <KeyValues
              cols={2}
              items={[
                { label: "Primary contact", value: contactLine(contact(app.primary_contact)) },
                app.type === "insurer" ? { label: "Compliance contact", value: contactLine(contact(app.compliance_contact)) } : { label: "Principal officer", value: contactLine(contact(app.principal_officer)) },
              ]}
            />
          </Panel>
          <Panel title="Settlement account" description="Bank or mobile money only; card data is never stored.">
            <KeyValues
              items={
                settlement.type === "momo"
                  ? [
                      { label: "Type", value: "Mobile money" },
                      { label: "Network", value: settlement.momo_network ?? "—" },
                      { label: "Number", value: settlement.momo_number ?? "—" },
                      { label: "Registered name", value: settlement.account_name ?? "—" },
                    ]
                  : settlement.type === "bank"
                    ? [
                        { label: "Type", value: "Bank account" },
                        { label: "Bank", value: settlement.bank_name ?? "—" },
                        { label: "Account name", value: settlement.account_name ?? "—" },
                        { label: "Account number", value: <span className="font-mono">{settlement.account_number ?? "—"}</span> },
                      ]
                    : [{ label: "Type", value: "Not provided" }]
              }
            />
          </Panel>
          <Panel title={app.type === "insurer" ? "Integration levels" : "Commercial model"}>
            {app.type === "insurer" ? (
              levels.length ? (
                <ul className="divide-y divide-line text-sm">
                  {levels.map((l) => (
                    <li key={l.category_slug} className="flex items-center justify-between py-2"><span className="capitalize">{l.category_slug.replace(/-/g, " ")}</span><Pill tone="info">{l.level}</Pill></li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No product lines chosen.</p>
              )
            ) : (
              <p className="text-sm text-ink">{app.commercial_model ? humanize(app.commercial_model) : "Not chosen"}</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Documents" description="Private files; links expire after 10 minutes.">
            {docs.length === 0 ? (
              <p className="text-sm text-muted">No documents uploaded.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {docs.map((d) => {
                  const url = urlFor(d.storage_path);
                  return (
                    <li key={d.storage_path} className="py-2">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">{d.name}</a>
                      ) : (
                        <span className="font-medium text-ink">{d.name}</span>
                      )}
                      <p className="text-xs text-muted">{humanize(d.kind)} · {formatDateTime(d.uploaded_at)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Partner agreement (e-signature)">
            {agreement.signed_at ? (
              <>
                <KeyValues
                  cols={2}
                  items={[
                    { label: "Signed by", value: `${agreement.signed_name}${agreement.signed_title ? `, ${agreement.signed_title}` : ""}` },
                    { label: "Signed at", value: formatDateTime(agreement.signed_at) },
                    { label: "Version", value: agreement.version ?? "—" },
                    { label: "IP address", value: agreement.ip || "—" },
                    { label: "Text fingerprint", value: <span className="font-mono text-xs">{agreement.hash?.slice(0, 16)}…</span> },
                    { label: "Matches current text", value: hashMatches ? <Pill tone="ok">Yes</Pill> : <Pill tone="wait">Older version</Pill> },
                  ]}
                />
                <p className="mt-2 text-xs text-muted">Provider: {agreement.provider || "in-app (typed name + consent)"} · {agreement.user_agent?.slice(0, 80) || "no user agent"}</p>
              </>
            ) : (
              <p className="text-sm text-danger">Not signed.</p>
            )}
          </Panel>

          {decidable && (
            <Panel title="Decision" description="Every decision notifies the applicant and is audited.">
              <ActionForm action={approveApplication} submitLabel="Approve and create organisation" readOnly={!canDecide || !completeness.complete}>
                <input type="hidden" name="applicationId" value={app.id} />
                <Checkbox name="nic_checked" label={`I checked ${app.nic_licence_number ?? "the licence"} on the NIC register and the name, class and expiry match.`} />
                <Field label="NIC register check — what you saw" htmlFor="nic-note">
                  <Textarea id="nic-note" name="nic_note" rows={2} placeholder="e.g. Listed as a non-life insurer, licence valid to 31 Dec 2027." />
                </Field>
                {!completeness.complete && <p className="text-xs text-danger">The application is incomplete — return it to the applicant.</p>}
              </ActionForm>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <ConfirmAction action={returnApplication} fields={{ applicationId: app.id }} label="Return with notes" title="Return to the applicant" confirmLabel="Return" variant="primary" reasonLabel="What needs to change (sent to the applicant)" disabled={!canDecide} body="The applicant can edit the application and resubmit. Your notes are shown on their status page and emailed."  />
                <ConfirmAction action={rejectApplication} fields={{ applicationId: app.id }} label="Reject" title="Reject this application" confirmLabel="Reject" confirmWord="REJECT" reasonLabel="Reason (sent to the applicant)" disabled={!canDecide} body="The applicant is notified with your reason. They can start a new application later." />
              </div>
            </Panel>
          )}
          {app.status === "needs_changes" && canDecide && (
            <Panel title="Decision">
              <p className="text-sm text-muted">Returned to the applicant. Rejecting is still possible.</p>
              <div className="mt-3">
                <ConfirmAction action={rejectApplication} fields={{ applicationId: app.id }} label="Reject" title="Reject this application" confirmLabel="Reject" confirmWord="REJECT" reasonLabel="Reason (sent to the applicant)" body="The applicant is notified with your reason." />
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
