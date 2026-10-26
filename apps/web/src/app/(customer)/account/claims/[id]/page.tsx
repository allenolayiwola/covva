import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check, Circle, FileText, Info, MapPin, Phone, Video, Wrench } from "lucide-react";
import {
  CLAIM_DISCLAIMER,
  CLAIM_JOB_STATUS,
  CLAIM_STATUS,
  SERVICE_PARTNER_KIND_LABELS,
  buildClaimTimeline,
  canMessage,
  formatDate,
  formatDateTime,
  formatGHS,
  humanize,
  nextExpectedStep,
  partnerKindsFor,
  type ServicePartnerKind,
} from "@im/core";
import { Card, DefinitionList, Notice, Pill, StatusPill, Timeline, buttonClass, type TimelineStep } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UploadDropzone } from "@/components/customer/upload";
import { formatBytes } from "@/components/customer/utils";
import { VideoUpload } from "@/components/customer/video-upload";
import { listClaimJobs, listClaimMessages, listServicePartners } from "@/server/claims";
import { ORG_COLS, UUID_RE, account, signUrls, type OrgLite } from "../../_lib/data";
import { PARTY_LABEL } from "../../_lib/labels";
import { attachClaimEvidence, attachClaimVideo, fulfilInfoRequestWithFile } from "../actions";
import { ClaimMessageComposer, InfoRequestReply } from "./thread";
import { WithdrawClaimForm } from "./withdraw-form";

export const metadata: Metadata = { title: "Claim" };

export default function ClaimPage({ params, searchParams }: PageProps<"/account/claims/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <ClaimDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const DECIDED = ["approved", "partially_approved", "rejected", "paid", "closed"];

async function ClaimDetail({ params, searchParams }: Pick<PageProps<"/account/claims/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const { user, supabase } = await account(`/account/claims/${id}`);
  const { data } = await supabase
    .from("claims")
    .select(`*, policy:policies(id, nickname, policy_number, internal_reference, request_id, category:product_categories(name, slug)), insurer:organizations!claims_insurer_org_id_fkey(${ORG_COLS}), broker:organizations!claims_broker_org_id_fkey(${ORG_COLS})`)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const claim = data as unknown as typeof data & {
    policy: { id: string; nickname: string | null; policy_number: string | null; internal_reference: string; request_id: string | null; category: { name: string; slug: string } | null } | null;
    insurer: OrgLite | null;
    broker: OrgLite | null;
  };
  const isCustomer = claim.customer_id === user.id;
  const [{ data: events }, { data: docs }, messages, { data: infoRequests }, jobs, { data: profile }] = await Promise.all([
    supabase.from("claim_events").select("id, from_status, to_status, note, actor_party, created_at").eq("claim_id", id).order("created_at", { ascending: true }),
    supabase.from("documents").select("id, file_name, storage_path, kind, size_bytes, duration_seconds, created_at, delivered_to_insurer_at").eq("claim_id", id).order("created_at", { ascending: false }),
    listClaimMessages(supabase, id),
    supabase.from("claim_info_requests").select("*").eq("claim_id", id).order("created_at", { ascending: false }),
    listClaimJobs(supabase, id),
    supabase.from("profiles").select("region").eq("id", user.id).maybeSingle(),
  ]);
  const urls = await signUrls(supabase, [...(docs ?? []).map((d) => d.storage_path), ...messages.flatMap((m) => ((m.attachments as { storage_path?: string }[] | null) ?? []).map((a) => a.storage_path ?? "").filter(Boolean))]);
  const status = claim.status;
  const evidence = (Array.isArray(claim.required_evidence) ? claim.required_evidence : []) as { key: string; label: string; kind?: string; documentKind?: string }[];
  const haveKinds = new Set((docs ?? []).map((d) => d.kind as string));
  const open = !["withdrawn", "closed", "paid", "rejected"].includes(status);
  const insurerName = claim.insurer?.name ?? "The insurer";
  const now = new Date();
  const next = nextExpectedStep(claim, events ?? [], now);
  const stages = buildClaimTimeline(claim, events ?? [], now);
  const openRequests = (infoRequests ?? []).filter((r) => !r.fulfilled_at && r.requested_party === "customer");
  const answered = (infoRequests ?? []).filter((r) => r.fulfilled_at || r.requested_party !== "customer");
  const messagingOpen = canMessage(isCustomer ? "customer" : "sponsor", claim);

  // Partner network near the customer: kinds for this category, the customer's region first, direct billing when the insurer supports it.
  const kinds: ServicePartnerKind[] = partnerKindsFor(claim.policy?.category?.slug, claim.incident_type);
  const partners = kinds.length ? await listServicePartners(supabase, { kind: kinds, region: profile?.region ?? null, insurerOrgId: claim.insurer_org_id, limit: 6 }).catch(() => []) : [];
  const nearby = partners.length ? partners : kinds.length ? await listServicePartners(supabase, { kind: kinds, insurerOrgId: claim.insurer_org_id, limit: 4 }).catch(() => []) : [];

  // Journey: fixed stages with reached / expected times — never an open-ended "processing".
  const steps: TimelineStep[] = stages.map((s) => ({
    title: s.label,
    state: s.state,
    detail: (
      <>
        {s.at ? <span>{formatDateTime(s.at)}</span> : s.expectedBy ? <span className={s.overdue ? "text-danger" : undefined}>Expected by {formatDateTime(s.expectedBy)}{s.overdue ? " · taking longer than expected" : ""}</span> : s.expectedLabel ? <span>Expected {s.expectedLabel}</span> : null}
        <span className="block text-ink-2">{s.hint}</span>
      </>
    ),
  }));
  const notes = (events ?? []).filter((e) => e.note);

  return (
    <div>
      <RealtimeRefresh channel={`claim:${id}`} watch={[{ table: "claims", filter: `id=eq.${id}` }, { table: "claim_messages", filter: `claim_id=eq.${id}` }]} />
      <Breadcrumbs items={[{ label: "Claims", href: "/account/claims" }, { label: claim.reference }]} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-[36px]">{humanize(claim.incident_type)} claim</h1>
        <StatusPill meta={CLAIM_STATUS[status]} />
      </div>
      <p className="mt-1 text-[15px] text-muted">
        {claim.policy?.category?.name} · {insurerName} · Policy {claim.policy?.policy_number ?? claim.policy?.internal_reference} · {claim.reference}
      </p>

      {sp.reported && (
        <Notice tone="ok" className="mt-5" title="Claim reported to your broker">
          Your broker will check it and send it to {insurerName}. Reporting a claim does not mean it is approved.
        </Notice>
      )}
      {open && (
        <Notice tone={next.overdue ? "wait" : "info"} className="mt-5" title="What happens next">
          {next.message}
        </Notice>
      )}
      {status === "info_requested" && openRequests.length === 0 && (
        <Notice tone="wait" className="mt-5" title="More information needed">
          {claim.decision_note ?? "The insurer needs more information. Add the documents below or message your broker."}
        </Notice>
      )}
      {DECIDED.includes(status) && status !== "closed" && (
        <Notice tone={status === "rejected" ? "danger" : "ok"} className="mt-5" title={`Decision by ${insurerName}`}>
          {CLAIM_STATUS[status].label}
          {claim.decision_amount != null ? ` · ${formatGHS(Number(claim.decision_amount))}` : ""}
          {claim.decision_at ? ` · ${formatDate(claim.decision_at)}` : ""}
          {claim.decision_note ? <span className="mt-1 block">{claim.decision_note}</span> : null}
          {status === "rejected" && (
            <span className="mt-1 block">
              You can ask your broker to explain, or <Link href={`/account/complaints/new?claim=${claim.id}`} className="font-semibold underline">raise a complaint</Link>.
            </span>
          )}
        </Notice>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="timeline">
            <h2 id="timeline" className="text-lg font-semibold text-ink">Timeline</h2>
            <p className="mt-1 text-sm text-muted">Expected times are targets, not guarantees. Only {insurerName} can approve, decline or pay a claim.</p>
            <Timeline className="mt-4" steps={steps} />
            {notes.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm">
                {notes.map((e) => (
                  <li key={e.id} className="rounded-card border border-line px-4 py-3">
                    <span className="text-xs text-subtle">{formatDateTime(e.created_at)} · {PARTY_LABEL[e.actor_party] ?? e.actor_party}</span>
                    <span className="block text-ink-2">{e.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {openRequests.length > 0 && (
            <section aria-labelledby="info-requests">
              <h2 id="info-requests" className="text-lg font-semibold text-ink">Information requested from you</h2>
              <p className="mt-1 text-sm text-muted">Replying quickly keeps the assessment moving.</p>
              <ul className="mt-4 space-y-4">
                {openRequests.map((r) => (
                  <li key={r.id} className="rounded-card border border-amber/40 bg-amber-bg/40 p-4">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-subtle">
                      <Pill tone="wait">{r.kind === "inspection" ? "Inspection" : r.kind === "information" ? "Information" : "Document"}</Pill>
                      {PARTY_LABEL[r.requested_by_party] ?? r.requested_by_party} · {formatDate(r.created_at)}{r.due_at ? ` · needed by ${formatDate(r.due_at)}` : ""}
                    </p>
                    <p className="mt-2 font-medium text-ink">{r.message}</p>
                    {r.kind !== "information" && (
                      <UploadDropzone className="mt-3" compact userId={user.id} scope="claims" title="Upload the requested file" buttonLabel="Upload" action={fulfilInfoRequestWithFile.bind(null, claim.id, r.id)} />
                    )}
                    <InfoRequestReply claimId={claim.id} requestId={r.id} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open && evidence.length > 0 && (
            <section aria-labelledby="evidence">
              <h2 id="evidence" className="text-lg font-semibold text-ink">Evidence checklist</h2>
              <p className="mt-1 text-sm text-muted">What the insurer usually needs for this kind of claim. Your broker may ask for more.</p>
              <ul className="mt-4 space-y-4">
                {evidence.map((e) => {
                  const kind = e.kind ?? e.documentKind ?? "";
                  const done = kind ? haveKinds.has(kind) : false;
                  if (!kind) return null;
                  return (
                    <li key={e.key} className="rounded-card border border-line p-4">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        {done ? <Check aria-label="Provided" className="size-4 text-brand" /> : <Circle aria-label="Still needed" className="size-4 text-subtle" />}
                        {e.label}
                        {done && <Pill tone="ok" className="ml-auto">Uploaded</Pill>}
                      </p>
                      {!done && isCustomer && (
                        <UploadDropzone className="mt-3" compact userId={user.id} scope="claims" title={`Upload ${e.label.toLowerCase()}`} buttonLabel="Upload" action={attachClaimEvidence.bind(null, claim.id, kind)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="files">
            <h2 id="files" className="text-lg font-semibold text-ink">Files you&apos;ve sent</h2>
            <p className="mt-1 text-sm text-muted">An upload isn&apos;t insurer notification until delivery is confirmed.</p>
            {(docs ?? []).length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-card border border-line">
                {(docs ?? []).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    {d.kind === "claim_video" ? <Video aria-hidden className="size-4 shrink-0 text-muted" /> : <FileText aria-hidden className="size-4 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1">
                      {urls[d.storage_path] ? (
                        <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink hover:text-brand hover:underline">{d.file_name}</a>
                      ) : (
                        <span className="block truncate font-medium text-ink">{d.file_name}</span>
                      )}
                      <span className="block text-xs text-subtle">{[humanize(d.kind), d.duration_seconds != null ? `${d.duration_seconds}s` : null, formatBytes(d.size_bytes), formatDate(d.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered to insurer</Pill> : <Pill tone="neutral">With your broker</Pill>}
                  </li>
                ))}
              </ul>
            )}
            {open && isCustomer && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <UploadDropzone compact userId={user.id} scope="claims" title="Add more evidence" hint="Photos, reports, receipts · PDF, JPG or PNG · up to 10 MB" buttonLabel="Upload" action={attachClaimEvidence.bind(null, claim.id, null)} />
                <div className="rounded-xl border border-dashed border-line bg-mist/40 p-3">
                  <VideoUpload userId={user.id} action={attachClaimVideo.bind(null, claim.id)} label="Add a short video" />
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="messages">
            <h2 id="messages" className="text-lg font-semibold text-ink">Messages</h2>
            <p className="mt-1 text-sm text-muted">Your broker and {insurerName} see this thread. Internal notes between them are not shown.</p>
            {messages.length === 0 ? (
              <p className="mt-3 rounded-card border border-line px-4 py-6 text-center text-sm text-muted">No messages yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {messages.map((m) => {
                  const mine = m.author_id === user.id;
                  const attachments = ((m.attachments as { storage_path?: string; name: string }[] | null) ?? []);
                  return (
                    <li key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div className={`max-w-[85%] rounded-card px-4 py-3 text-sm ${mine ? "bg-mint-2/70 text-ink" : "border border-line bg-white text-ink"}`}>
                        <p className="text-xs text-subtle">{mine ? "You" : PARTY_LABEL[m.author_party] ?? humanize(m.author_party)} · {formatDateTime(m.created_at)}</p>
                        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                        {attachments.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {attachments.map((a, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs">
                                <FileText aria-hidden className="size-3.5 text-muted" />
                                {a.storage_path && urls[a.storage_path] ? <a href={urls[a.storage_path]} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">{a.name}</a> : <span>{a.name}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {messagingOpen ? <div className="mt-4"><ClaimMessageComposer claimId={claim.id} userId={user.id} /></div> : <p className="mt-3 text-sm text-muted">This claim is closed, so the thread is read-only.</p>}
            {answered.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted">Earlier information requests ({answered.length})</summary>
                <ul className="mt-2 space-y-2">
                  {answered.map((r) => (
                    <li key={r.id} className="rounded-card border border-line px-4 py-3">
                      <span className="text-xs text-subtle">{formatDate(r.created_at)} · {PARTY_LABEL[r.requested_by_party] ?? r.requested_by_party} asked {r.requested_party === "customer" ? "you" : "your broker"}</span>
                      <span className="block text-ink">{r.message}</span>
                      {r.fulfilled_at ? <span className="block text-xs text-brand-dark">Answered {formatDate(r.fulfilled_at)}{r.response ? `: ${r.response}` : ""}</span> : <span className="block text-xs text-muted">Waiting for your broker</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {open && isCustomer && ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"].includes(status) && (
            <div className="max-w-md">
              <WithdrawClaimForm claimId={claim.id} />
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <DefinitionList
              items={[
                { label: "Reference", value: claim.reference },
                { label: "Happened", value: claim.incident_at ? formatDateTime(claim.incident_at) : "—" },
                ...(claim.location ? [{ label: "Where", value: claim.location }] : []),
                { label: "Reported", value: formatDate(claim.reported_at ?? claim.created_at) },
                ...(claim.amount_claimed ? [{ label: "Your estimate", value: formatGHS(Number(claim.amount_claimed)) }] : []),
                ...(claim.insurer_reference ? [{ label: "Insurer reference", value: claim.insurer_reference }] : []),
                { label: "Delivered to insurer", value: claim.delivered_to_insurer_at ? formatDate(claim.delivered_to_insurer_at) : "Not yet" },
              ]}
            />
            {claim.description && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm text-ink-2">{claim.description}</p>}
          </Card>

          {jobs.length > 0 && (
            <Card className="p-5" as="section" aria-labelledby="jobs">
              <h2 id="jobs" className="flex items-center gap-2 text-base font-semibold text-ink"><Wrench aria-hidden className="size-4 text-brand" /> Repairs and services</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {jobs.map((j) => (
                  <li key={j.id} className="rounded-xl border border-line p-3">
                    <p className="flex items-center justify-between gap-2 font-medium text-ink">
                      <span>{j.partner?.name ?? "Service partner"}</span>
                      <Pill tone={CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.tone ?? "neutral"}>{CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.label ?? humanize(j.status)}</Pill>
                    </p>
                    <p className="text-xs text-muted">{humanize(j.kind)}{j.partner?.kind ? ` · ${SERVICE_PARTNER_KIND_LABELS[j.partner.kind as ServicePartnerKind] ?? j.partner.kind}` : ""}{j.scheduled_for ? ` · ${formatDateTime(j.scheduled_for)}` : ""}</p>
                    {j.partner?.address && <p className="mt-1 flex items-start gap-1 text-xs text-ink-2"><MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted" />{j.partner.address}</p>}
                    {j.partner?.phone && <a href={`tel:${j.partner.phone}`} className="mt-1 flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Phone aria-hidden className="size-3.5" />{j.partner.phone}</a>}
                    {j.direct_billing ? <p className="mt-2 rounded-lg bg-mint px-2 py-1 text-xs font-medium text-brand-deep">Direct billing — you don&apos;t pay upfront. {insurerName} settles with the partner.</p> : j.estimate != null ? <p className="mt-1 text-xs text-muted">Estimate {formatGHS(Number(j.estimate))}</p> : null}
                    {j.notes && <p className="mt-1 text-xs text-ink-2">{j.notes}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {kinds.length > 0 && (
            <Card className="p-5" as="section" aria-labelledby="network">
              <h2 id="network" className="text-base font-semibold text-ink">Approved {kinds.includes("garage") ? "garages" : kinds.includes("hospital") ? "hospitals and clinics" : "partners"} near you</h2>
              <p className="mt-1 text-xs text-muted">{profile?.region ? `In ${profile.region}. ` : ""}Partners that direct-bill {insurerName} mean you don&apos;t pay upfront.</p>
              {nearby.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No approved partners listed yet. Your broker will tell you where to go.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {nearby.slice(0, 4).map((p) => (
                    <li key={p.id} className="rounded-xl border border-line p-3">
                      <p className="flex flex-wrap items-center justify-between gap-1 font-medium text-ink">
                        <span>{p.name}</span>
                        <span className="text-xs font-normal text-muted">{SERVICE_PARTNER_KIND_LABELS[p.kind as ServicePartnerKind] ?? p.kind}</span>
                      </p>
                      <p className="text-xs text-muted">{[p.address, p.region].filter(Boolean).join(" · ")}</p>
                      {p.phone && <a href={`tel:${p.phone}`} className="mt-0.5 block text-xs font-medium text-brand hover:underline">{p.phone}</a>}
                      {p.directBilling && <Pill tone="ok" className="mt-1.5">Direct billing — you don&apos;t pay upfront</Pill>}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/claims/network" className="mt-3 block text-sm font-medium text-brand hover:underline">See the full partner network</Link>
            </Card>
          )}

          <Notice tone="neutral" icon={<Info className="size-4" />}>{CLAIM_DISCLAIMER}</Notice>
          {claim.policy?.request_id ? (
            <Link href={`/account/requests/${claim.policy.request_id}/messages`} className={buttonClass("secondary", "md", "w-full")}>Message your broker</Link>
          ) : (
            <Link href="/account/messages" className={buttonClass("secondary", "md", "w-full")}>Message your broker</Link>
          )}
          {claim.policy && (
            <Link href={`/account/policies/${claim.policy.id}`} className="block text-center text-sm font-medium text-brand hover:underline">View policy</Link>
          )}
        </aside>
      </div>
    </div>
  );
}
