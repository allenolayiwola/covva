import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MessageSquare } from "lucide-react";
import { OPEN_REQUEST_STATUSES, formatDateTime } from "@im/core";
import { Avatar, EmptyState, PageHeader, buttonClass } from "@im/ui";
import { brokerContact } from "@/components/customer/broker-card";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { ListSkeleton } from "@/components/customer/skeletons";
import { CATEGORY_COLS, ORG_COLS, account, type CategoryLite, type OrgLite } from "../_lib/data";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return (
    <>
      <PageHeader title="Messages" description="Conversations with your broker, one thread per request, with documents in context." />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Threads />
      </Suspense>
    </>
  );
}

type Req = { id: string; reference: string; title: string | null; status: string; created_at: string; category: CategoryLite | null; broker: OrgLite | null };

async function Threads() {
  const { user, supabase } = await account("/account/messages");
  const [{ data: reqs }, { data: msgs }] = await Promise.all([
    supabase
      .from("requests")
      .select(`id, reference, title, status, created_at, category:product_categories(${CATEGORY_COLS}), broker:organizations!requests_broker_org_id_fkey(${ORG_COLS})`)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("request_messages")
      .select("id, request_id, body, sender_party, created_at, read_by_customer_at, request:requests!inner(customer_id)")
      .eq("request.customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const requests = (reqs ?? []) as unknown as Req[];
  const byReq = new Map<string, { last: NonNullable<typeof msgs>[number]; unread: number }>();
  for (const m of msgs ?? []) {
    const cur = byReq.get(m.request_id);
    const unread = m.sender_party !== "customer" && !m.read_by_customer_at ? 1 : 0;
    if (!cur) byReq.set(m.request_id, { last: m, unread });
    else cur.unread += unread;
  }
  const threads = requests.filter((r) => byReq.has(r.id)).sort((a, b) => byReq.get(b.id)!.last.created_at.localeCompare(byReq.get(a.id)!.last.created_at));
  const quiet = requests.filter((r) => !byReq.has(r.id) && (OPEN_REQUEST_STATUSES as string[]).includes(r.status));

  if (!threads.length && !quiet.length) {
    return (
      <EmptyState
        icon={<MessageSquare className="size-5" />}
        title="No conversations yet"
        body="When you request cover, you get a named broker. You can message them here about that request."
        action={<Link href="/account/requests/new" className={buttonClass("primary")}>Get a quote</Link>}
      />
    );
  }

  return (
    <div className="space-y-8">
      <RealtimeRefresh channel="messages-index" watch={[{ table: "request_messages" }]} />
      {threads.length > 0 && (
        <ul className="divide-y divide-line rounded-card border border-line">
          {threads.map((r) => {
            const t = byReq.get(r.id)!;
            const c = brokerContact(r.broker);
            return (
              <li key={r.id}>
                <Link href={`/account/requests/${r.id}/messages`} className="flex items-center gap-3 px-4 py-4 hover:bg-mist/60">
                  <Avatar name={c?.displayName ?? "Broker"} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={t.unread ? "truncate font-semibold text-ink" : "truncate font-medium text-ink"}>{c?.displayName ?? "Your broker"}</p>
                      <span className="shrink-0 text-xs text-subtle">{formatDateTime(t.last.created_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted">{r.title ?? r.category?.name} · {r.reference}</p>
                    <p className={t.unread ? "mt-0.5 truncate text-sm font-medium text-ink" : "mt-0.5 truncate text-sm text-muted"}>
                      {t.last.sender_party === "customer" ? "You: " : ""}
                      {t.last.body}
                    </p>
                  </div>
                  {t.unread > 0 && (
                    <span className="grid min-w-6 place-items-center rounded-full bg-brand px-1.5 text-xs font-semibold leading-6 text-white" aria-label={`${t.unread} unread`}>
                      {t.unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {quiet.length > 0 && (
        <section aria-labelledby="start">
          <h2 id="start" className="mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-muted">Start a conversation</h2>
          <ul className="divide-y divide-line rounded-card border border-line">
            {quiet.map((r) => (
              <li key={r.id}>
                <Link href={`/account/requests/${r.id}/messages`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-mist/60">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{r.title ?? r.category?.name}</span>
                    <span className="block text-xs text-muted">{r.reference}{r.broker ? ` · ${r.broker.name}` : ""}</span>
                  </span>
                  <span className="text-sm font-medium text-brand">Message</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
