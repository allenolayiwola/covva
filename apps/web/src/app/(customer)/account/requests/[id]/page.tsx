import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, FileText, MessageSquare } from "lucide-react";
import { OPEN_REQUEST_STATUSES, REQUEST_STATUS, buildDisclosure, formatDate, formatDateTime, formatGHS, relativeDue, type RequestStatus } from "@im/core";
import type { Row } from "@im/db";
import { Card, DefinitionList, Notice, Pill, StatusPill, Timeline, buttonClass, type TimelineStep } from "@im/ui";
import { BrokerCard, brokerContact } from "@/components/customer/broker-card";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { CategoryIcon } from "@/components/customer/category-icon";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UploadDropzone } from "@/components/customer/upload";
import { formatBytes } from "@/components/customer/utils";
import { TransactionParties } from "@/components/transaction-parties";
import { CATEGORY_COLS, account, getRequestOr404, signUrls } from "../../_lib/data";
import { PARTY_LABEL, REQUEST_TYPE_LABEL } from "../../_lib/labels";
import { attachRequestDocument } from "./actions";
import { BrokerChangeForm } from "./broker-change-form";
import { CancelRequestForm } from "./cancel-form";

export const metadata: Metadata = { title: "Request" };

export default function RequestPage({ params, searchParams }: PageProps<"/account/requests/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Tracker params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const ORDER: RequestStatus[] = ["draft", "submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents", "completed"];
const at = (s: RequestStatus) => ORDER.indexOf(s);

async function Tracker({ params, searchParams }: Pick<PageProps<"/account/requests/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, supabase } = await account(`/account/requests/${id}`);
  const request = await getRequestOr404(supabase, id);

  const [eventsRes, tasksRes, quotesRes, docsRes, othersRes, lastMsgRes, unreadRes] = await Promise.all([
    supabase.from("request_events").select("id, event, from_status, to_status, note, actor_party, created_at, data").eq("request_id", id).order("created_at", { ascending: true }),
    supabase.from("request_tasks").select("*").eq("request_id", id).order("created_at", { ascending: true }),
    supabase.from("quotes").select("id, status, premium, insurer_org_id, valid_until, product_version_id, insurer:organizations!quotes_insurer_org_id_fkey(name, nic_licence_number, settings)").eq("request_id", id),
    supabase.from("documents").select("id, file_name, storage_path, size_bytes, kind, created_at, delivered_to_insurer_at, task_id").eq("request_id", id).order("created_at", { ascending: false }),
    supabase
      .from("requests")
      .select(`id, reference, title, status, category:product_categories(${CATEGORY_COLS})`)
      .eq("customer_id", user.id)
      .neq("id", id)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase.from("request_messages").select("body, sender_party, created_at").eq("request_id", id).neq("sender_party", "customer").order("created_at", { ascending: false }).limit(1),
    supabase.from("request_messages").select("id", { count: "exact", head: true }).eq("request_id", id).neq("sender_party", "customer").is("read_by_customer_at", null),
  ]);

  const events = eventsRes.data ?? [];
  const tasks = (tasksRes.data ?? []) as Row<"request_tasks">[];
  const quotes = (quotesRes.data ?? []) as unknown as { id: string; status: string; premium: number; insurer_org_id: string; valid_until: string | null; product_version_id: string | null; insurer: { name: string; nic_licence_number: string | null; settings: unknown } | null }[];
  const docs = docsRes.data ?? [];
  const others = (othersRes.data ?? []) as unknown as { id: string; reference: string; title: string | null; status: RequestStatus; category: { icon: string | null; name: string } | null }[];
  const lastBrokerMsg = lastMsgRes.data?.[0];
  const unread = unreadRes.count ?? 0;
  const urls = await signUrls(supabase, docs.map((d) => d.storage_path));

  const status = request.status;
  const s = at(status);
  const isClosed = status === "cancelled" || status === "closed_no_cover";
  const openCustomerTasks = tasks.filter((t) => t.status === "open" && t.assignee_party === "customer");
  const doneCustomerTasks = tasks.filter((t) => t.status === "done" && t.assignee_party === "customer");
  const liveQuotes = quotes.filter((q) => ["estimate", "awaiting_underwriting", "ready_to_accept", "accepted"].includes(q.status));
  const ready = liveQuotes.filter((q) => q.status === "ready_to_accept" && (!q.valid_until || new Date(q.valid_until) > new Date()));
  const insurers = new Set(liveQuotes.map((q) => q.insurer_org_id)).size;
  // Transparency block: the accepted quote's insurer once chosen, otherwise every participating insurer.
  const acceptedQuote = quotes.find((q) => q.status === "accepted") ?? null;
  const partyQuotes = acceptedQuote ? [acceptedQuote] : liveQuotes;
  const partyInsurers = [...new Map(partyQuotes.filter((q) => q.insurer).map((q) => [q.insurer_org_id, { name: q.insurer!.name, nic_licence_number: q.insurer!.nic_licence_number, settings: q.insurer!.settings }])).values()];
  const cheapest = ready.length ? Math.min(...ready.map((q) => Number(q.premium))) : liveQuotes.length ? Math.min(...liveQuotes.map((q) => Number(q.premium))) : null;
  const broker = request.broker;
  const contact = brokerContact(broker);
  const quoteFlow = request.type !== "endorsement" && request.type !== "service";
  const due = request.due_at && (OPEN_REQUEST_STATUSES as string[]).includes(status) ? relativeDue(request.due_at) : null;
  const submittedEvent = events.find((e) => e.to_status === "submitted") ?? events[0];

  // Pending change of broker: open customer review task + latest proposal event naming the new broker.
  const handoverTask = openCustomerTasks.find((t) => t.kind === "review" && /broker/i.test(t.title));
  const proposal = handoverTask ? ([...events].reverse().find((e) => e.event === "broker_change_proposed")?.data as { target_broker_org_id?: string; reason?: string } | null) : null;
  const { data: newBroker } = proposal?.target_broker_org_id
    ? await supabase.from("organizations").select("id, name, nic_licence_number").eq("id", proposal.target_broker_org_id).maybeSingle()
    : { data: null };

  // ------------------------------------------------------------------ timeline
  const steps: TimelineStep[] = [];
  steps.push({
    title: status === "draft" ? "Draft — not sent yet" : "Request received",
    detail: formatDateTime(request.submitted_at ?? submittedEvent?.created_at ?? request.created_at),
    state: status === "draft" ? "current" : "done",
  });
  steps.push({
    title: broker ? "Assigned to your broker" : "Finding your broker",
    detail: broker ? (contact?.person ? `${contact.person} · ${broker.name}` : broker.name) : "We route every request to one licensed broker of record.",
    state: broker ? "done" : isClosed ? "upcoming" : "current",
  });
  for (const t of doneCustomerTasks) {
    steps.push({ title: t.title, detail: t.completed_at ? `Done ${formatDateTime(t.completed_at)}` : "Done", state: "done" });
  }
  for (const t of openCustomerTasks) {
    if (t.id === handoverTask?.id && newBroker) {
      steps.push({
        title: "Confirm your new broker",
        detail: `${broker?.name ?? "Your broker"} has proposed ${newBroker.name} as your broker of record.`,
        state: isClosed ? "upcoming" : "current",
        action: isClosed ? undefined : (
          <BrokerChangeForm
            requestId={request.id}
            taskId={t.id}
            newBroker={newBroker.name}
            currentBroker={broker?.name ?? "Your current broker"}
            reason={proposal?.reason ?? null}
            disclosure={buildDisclosure({ broker: { name: newBroker.name, licence: newBroker.nic_licence_number } })}
          />
        ),
      });
      continue;
    }
    steps.push({
      title: t.title,
      detail: (
        <>
          {t.detail ?? (t.kind === "document" ? "Upload to continue quote preparation" : "Your broker needs this to continue")}
          {t.due_at && <span className="text-amber"> · due {relativeDue(t.due_at).label.toLowerCase()}</span>}
        </>
      ),
      state: isClosed ? "upcoming" : "current",
      action: isClosed ? undefined : t.kind === "document" || t.kind === "signature" ? (
        <UploadDropzone
          userId={user.id}
          scope="requests"
          title={`Drop your ${t.document_kind ? t.document_kind.replace(/_/g, " ") : "document"} here`}
          hint="PDF, JPG or PNG · up to 10 MB"
          action={attachRequestDocument.bind(null, request.id, t.id)}
          className="max-w-xl"
        />
      ) : (
        <Link href={`/account/requests/${request.id}/messages`} className={buttonClass("primary", "sm")}>
          <MessageSquare aria-hidden className="size-4" /> Reply to your broker
        </Link>
      ),
    });
  }
  if (quoteFlow) {
    const quotesDone = liveQuotes.length > 0 && s >= at("quotes_ready");
    steps.push({
      title: "Quotes prepared",
      detail: quotesDone
        ? `${liveQuotes.length} quote${liveQuotes.length === 1 ? "" : "s"} from ${insurers} participating insurer${insurers === 1 ? "" : "s"}`
        : liveQuotes.length
          ? `${liveQuotes.length} estimate${liveQuotes.length === 1 ? "" : "s"} so far · insurers are confirming`
          : due
            ? `Target: ${due.label.toLowerCase()}`
            : "Target: within 1 working day",
      state: quotesDone ? "done" : !isClosed && !openCustomerTasks.length && s >= at("submitted") && s < at("quotes_ready") ? "current" : "upcoming",
    });
    steps.push({
      title: "Ready to accept",
      detail: s > at("quotes_ready") ? "You chose a quote" : "Choose your quote and pay",
      state: s > at("quotes_ready") ? "done" : status === "quotes_ready" ? "current" : "upcoming",
      action:
        status === "quotes_ready" ? (
          <Link href={`/account/requests/${request.id}/quotes`} className={buttonClass("primary", "sm")}>
            Compare quotes <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : undefined,
    });
    steps.push({
      title: "Payment confirmed",
      detail: "Paid directly to the insurer through an authorised provider",
      state: s > at("payment_confirmation") ? "done" : status === "payment_confirmation" ? "current" : "upcoming",
    });
    steps.push({
      title: "Policy issued",
      detail: status === "completed" ? "Documents are in My cover" : "Cover starts once the insurer confirms and issues documents",
      state: status === "completed" ? "done" : status === "policy_documents" ? "current" : "upcoming",
    });
  } else {
    steps.push({
      title: "Broker reviewing your change",
      state: status === "completed" ? "done" : !isClosed && !openCustomerTasks.length ? "current" : "upcoming",
    });
    steps.push({ title: "Insurer confirms the change", detail: "An endorsement is issued to your policy", state: status === "completed" ? "done" : "upcoming" });
  }

  const awaitingDoc = openCustomerTasks.some((t) => t.kind === "document");
  const pill = awaitingDoc && !isClosed ? { label: "Awaiting your document", tone: "wait" as const } : REQUEST_STATUS[status];
  const heading =
    status === "completed" ? "All done." : status === "quotes_ready" ? "Your quotes are ready." : isClosed ? "This request is closed." : status === "draft" ? "Finish your request." : "We’re on it.";
  const visibleEvents = events.filter((e) => e.event !== "created" || events.length === 1).slice(-8).reverse();

  return (
    <div>
      <RealtimeRefresh
        channel={`request:${request.id}`}
        watch={[
          { table: "requests", filter: `id=eq.${request.id}` },
          { table: "request_tasks", filter: `request_id=eq.${request.id}` },
          { table: "request_messages", filter: `request_id=eq.${request.id}` },
          { table: "quotes", filter: `request_id=eq.${request.id}` },
        ]}
      />
      <Breadcrumbs items={[{ label: "Requests", href: "/account/requests" }, { label: request.reference }]} />
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink sm:text-[44px]">{heading}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-muted">
            <span>
              {request.category?.name} {REQUEST_TYPE_LABEL[request.type]?.toLowerCase() ?? ""}
              {request.title && request.title !== request.category?.name ? ` · ${request.title}` : ""} · {request.reference}
            </span>
            <StatusPill meta={pill} />
          </div>

          {sp.new && (
            <Notice tone="ok" className="mt-5" title="Request sent">
              {broker ? `${contact?.displayName ?? broker.name} at ${broker.name} is your broker of record for this request.` : "We're assigning a broker now."}{" "}
              We&apos;ll notify you at each step.
            </Notice>
          )}
          {status === "cancelled" && <Notice tone="neutral" className="mt-5">You cancelled this request{request.cancelled_reason ? ` (${request.cancelled_reason})` : ""}. Any existing policy is unaffected.</Notice>}
          {status === "closed_no_cover" && (
            <Notice tone="neutral" className="mt-5">
              {events.some((e) => e.event === "insurer_declined")
                ? "The insurer could not accept this application, so no cover was arranged. Any premium you paid is being refunded. Your broker will suggest alternatives."
                : "Your broker closed this request without arranging cover. Message them if you'd like to know why."}
            </Notice>
          )}
          {request.next_step && !isClosed && <p className="mt-5 text-[15px] text-ink-2"><span className="font-semibold">Next step: </span>{request.next_step}</p>}

          <Timeline steps={steps} className="mt-7" />

          {liveQuotes.length > 0 && (
            <Card className="mt-8 flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  {liveQuotes.length} broker-prepared quote{liveQuotes.length === 1 ? "" : "s"} from {insurers} participating insurer{insurers === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-muted">
                  {ready.length ? `${ready.length} ready to accept` : "Awaiting insurer confirmation"}
                  {cheapest != null ? ` · from ${formatGHS(cheapest)} / year` : ""}
                </p>
              </div>
              <Link href={`/account/requests/${request.id}/quotes`} className={buttonClass(status === "quotes_ready" ? "primary" : "secondary")}>
                Compare quotes
              </Link>
            </Card>
          )}

          <section aria-labelledby="docs" className="mt-10">
            <h2 id="docs" className="text-lg font-semibold text-ink">Documents for this request</h2>
            <p className="mt-1 text-sm text-muted">An upload is not insurer notification until your broker confirms delivery.</p>
            {docs.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-card border border-line">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      {urls[d.storage_path] ? (
                        <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" className="truncate font-medium text-ink hover:text-brand hover:underline">{d.file_name}</a>
                      ) : (
                        <span className="truncate font-medium text-ink">{d.file_name}</span>
                      )}
                      <span className="block text-xs text-subtle">{[formatBytes(d.size_bytes), formatDate(d.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {d.delivered_to_insurer_at ? <Pill tone="ok">Delivered to insurer</Pill> : <Pill tone="neutral">With your broker</Pill>}
                  </li>
                ))}
              </ul>
            )}
            {!isClosed && (
              <UploadDropzone
                className="mt-3"
                userId={user.id}
                scope="requests"
                title="Add another document"
                hint="Anything your broker asked for · PDF, JPG or PNG · up to 10 MB"
                buttonLabel="Upload"
                compact
                action={attachRequestDocument.bind(null, request.id, null)}
              />
            )}
          </section>

          {visibleEvents.length > 0 && (
            <section aria-labelledby="updates" className="mt-10">
              <h2 id="updates" className="text-lg font-semibold text-ink">Updates</h2>
              <ul className="mt-3 space-y-3">
                {visibleEvents.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="w-28 shrink-0 text-subtle">{formatDateTime(e.created_at)}</span>
                    <span className="text-ink-2">
                      {e.event === "status_changed" && e.to_status ? (
                        <>Status: <span className="font-medium text-ink">{REQUEST_STATUS[e.to_status].label}</span></>
                      ) : e.event === "created" ? (
                        "Request created"
                      ) : e.event === "broker_assigned" ? (
                        "Broker of record assigned"
                      ) : e.event === "broker_changed" ? (
                        e.note ?? "Broker of record changed with your consent"
                      ) : e.event === "insurer_declined" ? (
                        e.note ?? "The insurer could not accept the application"
                      ) : e.event === "payment_refunded" ? (
                        e.note ?? "Premium refund"
                      ) : (
                        e.note ?? e.event.replace(/_/g, " ")
                      )}
                      {e.event === "status_changed" && e.note ? ` — ${e.note}` : ""}
                      <span className="text-subtle"> · {PARTY_LABEL[e.actor_party] ?? e.actor_party}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {["draft", "awaiting_customer_info", "quotes_ready"].includes(status) && (
            <div className="mt-10 max-w-md">
              <CancelRequestForm requestId={request.id} />
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <BrokerCard
            broker={broker}
            messageHref={`/account/requests/${request.id}/messages`}
            quote={lastBrokerMsg ? (lastBrokerMsg.body.length > 180 ? `${lastBrokerMsg.body.slice(0, 177)}…` : lastBrokerMsg.body) : undefined}
          />
          <TransactionParties
            stage="request"
            insurers={partyInsurers}
            broker={broker ? { name: broker.name, nic_licence_number: broker.nic_licence_number } : null}
            productVersionId={acceptedQuote?.product_version_id ?? (partyQuotes.length === 1 ? partyQuotes[0]!.product_version_id : null)}
          />
          {unread > 0 && (
            <Link href={`/account/requests/${request.id}/messages`} className="flex items-center gap-2 rounded-xl bg-mint-2 px-4 py-3 text-sm font-medium text-brand-deep hover:bg-mint">
              <MessageSquare aria-hidden className="size-4" /> {unread} new message{unread === 1 ? "" : "s"} from your broker
            </Link>
          )}
          <div>
            <DefinitionList
              items={[
                ...(due ? [{ label: "Next update target", value: due.overdue ? "Your broker is on it" : due.label }] : []),
                { label: "Opened", value: formatDate(request.created_at) },
                { label: "Reference", value: request.reference },
              ]}
            />
            <p className="mt-2 text-xs text-subtle">Actual timing is confirmed by your broker.</p>
          </div>
          {others.length > 0 && (
            <div>
              <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">Other requests</h2>
              <ul className="divide-y divide-line">
                {others.map((o) => (
                  <li key={o.id}>
                    <Link href={`/account/requests/${o.id}`} className="flex items-center gap-3 py-3 hover:bg-mist/50">
                      <CategoryIcon icon={o.category?.icon} size="sm" className="bg-transparent text-brand" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{o.title ?? o.category?.name}</span>
                        <span className="block text-xs text-muted">{o.reference}</span>
                      </span>
                      <StatusPill meta={REQUEST_STATUS[o.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href="/account/claims/new" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Need to report a claim? <ArrowRight aria-hidden className="size-4" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
