import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check, Circle, FileText, Info } from "lucide-react";
import { CLAIM_DISCLAIMER, CLAIM_STATUS, formatDate, formatDateTime, formatGHS, humanize, type ClaimStatus } from "@im/core";
import { Card, DefinitionList, Notice, Pill, StatusPill, Timeline, buttonClass, type TimelineStep } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UploadDropzone } from "@/components/customer/upload";
import { formatBytes } from "@/components/customer/utils";
import { ORG_COLS, UUID_RE, account, signUrls, type OrgLite } from "../../_lib/data";
import { PARTY_LABEL } from "../../_lib/labels";
import { attachClaimEvidence } from "../actions";
import { WithdrawClaimForm } from "./withdraw-form";

export const metadata: Metadata = { title: "Claim" };

export default function ClaimPage({ params, searchParams }: PageProps<"/account/claims/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <ClaimDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const PATH: ClaimStatus[] = ["reported", "delivered_to_insurer", "acknowledged", "under_assessment"];
const DECIDED: ClaimStatus[] = ["approved", "partially_approved", "rejected", "paid", "closed"];

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
  const [{ data: events }, { data: docs }] = await Promise.all([
    supabase.from("claim_events").select("id, from_status, to_status, note, actor_party, created_at").eq("claim_id", id).order("created_at", { ascending: true }),
    supabase.from("documents").select("id, file_name, storage_path, kind, size_bytes, created_at, delivered_to_insurer_at").eq("claim_id", id).order("created_at", { ascending: false }),
  ]);
  const urls = await signUrls(supabase, (docs ?? []).map((d) => d.storage_path));
  const status = claim.status;
  const evidence = (Array.isArray(claim.required_evidence) ? claim.required_evidence : []) as { key: string; label: string; kind: string }[];
  const haveKinds = new Set((docs ?? []).map((d) => d.kind as string));
  const open = !["withdrawn", "closed", "paid", "rejected"].includes(status);
  const insurerName = claim.insurer?.name ?? "The insurer";

  // Timeline: what has happened (claim_events), then the expected next stages — never implying approval.
  const steps: TimelineStep[] = (events ?? [])
    .filter((e) => e.to_status || e.note)
    .map((e) => ({
      title: e.to_status ? CLAIM_STATUS[e.to_status].label : e.note!,
      detail: (
        <>
          {formatDateTime(e.created_at)} · {PARTY_LABEL[e.actor_party] ?? e.actor_party}
          {e.to_status && e.note ? <span className="block text-ink-2">{e.note}</span> : null}
          {e.to_status && CLAIM_STATUS[e.to_status].customerHint ? <span className="block">{CLAIM_STATUS[e.to_status].customerHint}</span> : null}
        </>
      ),
      state: "done" as const,
    }));
  if (steps.length) steps[steps.length - 1]!.state = open ? "current" : "done";
  if (open) {
    const idx = PATH.indexOf(status);
    for (const s of PATH.slice(idx + 1)) {
      steps.push({ title: CLAIM_STATUS[s].label, state: "upcoming" });
    }
    if (status === "info_requested") {
      steps.push({ title: "Back to assessment once you reply", state: "upcoming" });
    }
    steps.push({ title: `${insurerName} decides`, detail: "Only the insurer can approve, decline or pay a claim.", state: "upcoming" });
  }

  return (
    <div>
      <RealtimeRefresh channel={`claim:${id}`} watch={[{ table: "claims", filter: `id=eq.${id}` }]} />
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
      {status === "info_requested" && (
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
          <Timeline steps={steps} />

          {open && evidence.length > 0 && (
            <section aria-labelledby="evidence">
              <h2 id="evidence" className="text-lg font-semibold text-ink">Evidence checklist</h2>
              <p className="mt-1 text-sm text-muted">What the insurer usually needs for this kind of claim. Your broker may ask for more.</p>
              <ul className="mt-4 space-y-4">
                {evidence.map((e) => {
                  const done = haveKinds.has(e.kind);
                  return (
                    <li key={e.key} className="rounded-card border border-line p-4">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        {done ? <Check aria-label="Provided" className="size-4 text-brand" /> : <Circle aria-label="Still needed" className="size-4 text-subtle" />}
                        {e.label}
                        {done && <Pill tone="ok" className="ml-auto">Uploaded</Pill>}
                      </p>
                      {!done && (
                        <UploadDropzone
                          className="mt-3"
                          compact
                          userId={user.id}
                          scope="claims"
                          title={`Upload ${e.label.toLowerCase()}`}
                          buttonLabel="Upload"
                          action={attachClaimEvidence.bind(null, claim.id, e.kind)}
                        />
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
                    <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      {urls[d.storage_path] ? (
                        <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-ink hover:text-brand hover:underline">{d.file_name}</a>
                      ) : (
                        <span className="block truncate font-medium text-ink">{d.file_name}</span>
                      )}
                      <span className="block text-xs text-subtle">{[humanize(d.kind), formatBytes(d.size_bytes), formatDate(d.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered to insurer</Pill> : <Pill tone="neutral">With your broker</Pill>}
                  </li>
                ))}
              </ul>
            )}
            {open && (
              <UploadDropzone
                className="mt-3"
                compact
                userId={user.id}
                scope="claims"
                title="Add more evidence"
                hint="Photos, reports, receipts · PDF, JPG or PNG · up to 10 MB"
                buttonLabel="Upload"
                action={attachClaimEvidence.bind(null, claim.id, null)}
              />
            )}
          </section>

          {open && ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"].includes(status) && (
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
