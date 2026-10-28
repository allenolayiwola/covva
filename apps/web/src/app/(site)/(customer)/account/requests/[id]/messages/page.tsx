import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, FileText, Phone } from "lucide-react";
import { formatDateTime } from "@im/core";
import { Avatar, cn } from "@im/ui";
import { brokerContact } from "@/components/customer/broker-card";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { PageSkeleton } from "@/components/customer/skeletons";
import { formatBytes } from "@/components/customer/utils";
import { account, getRequestOr404, signUrls } from "../../../_lib/data";
import { Composer, MarkRead } from "./composer";

export const metadata: Metadata = { title: "Messages" };

export default function ThreadPage({ params }: PageProps<"/account/requests/[id]/messages">) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Thread params={params} />
    </Suspense>
  );
}

type Attachment = { documentId?: string; name?: string; size?: number };

async function Thread({ params }: Pick<PageProps<"/account/requests/[id]/messages">, "params">) {
  const { id } = await params;
  const { user, supabase } = await account(`/account/requests/${id}/messages`);
  const request = await getRequestOr404(supabase, id);
  const [{ data: messages }, { data: docs }, { count: quoteCount }] = await Promise.all([
    // RLS hides internal broker notes from customers.
    supabase.from("request_messages").select("*").eq("request_id", id).order("created_at", { ascending: true }).limit(300),
    supabase.from("documents").select("id, storage_path, file_name, size_bytes").eq("request_id", id),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("request_id", id),
  ]);
  const list = messages ?? [];
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const urls = await signUrls(supabase, (docs ?? []).map((d) => d.storage_path));
  const contact = brokerContact(request.broker);
  const latestIncoming = [...list].reverse().find((m) => m.sender_party !== "customer");
  const lastMine = [...list].reverse().find((m) => m.sender_party === "customer");

  return (
    <div className="-mx-4 -mt-6 flex h-[calc(100dvh-4rem-64px)] flex-col sm:-mx-6 lg:mx-0 lg:mt-0 lg:h-[calc(100dvh-4rem-4rem)] lg:rounded-card lg:border lg:border-line">
      <RealtimeRefresh channel={`thread:${id}`} watch={[{ table: "request_messages", filter: `request_id=eq.${id}` }]} />
      <MarkRead requestId={id} latest={latestIncoming?.id ?? null} />
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href={`/account/requests/${id}`} className="grid size-9 place-items-center rounded-full text-brand hover:bg-mist" aria-label="Back to request">
          <ChevronLeft className="size-5" />
        </Link>
        <Avatar name={contact?.displayName ?? "Broker"} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-ink">{contact ? `${contact.displayName} · Broker` : "Your broker"}</h1>
          <p className="truncate text-xs text-muted">
            {contact?.person ? `${contact.firm} · ` : ""}About request {request.reference}
            {contact?.hours ? ` · ${contact.hours}` : ""}
          </p>
        </div>
        {contact?.phone && (
          <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="grid size-10 place-items-center rounded-full text-brand hover:bg-mist" aria-label={`Call ${contact.displayName}`}>
            <Phone className="size-5" />
          </a>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5" role="log" aria-live="polite" aria-label="Conversation">
        {list.length === 0 ? (
          <div className="mx-auto max-w-sm py-10 text-center">
            <p className="font-medium text-ink">Start the conversation</p>
            <p className="mt-1 text-sm text-muted">
              Ask {contact?.firstName ?? "your broker"} anything about this request. Messages and documents stay together here. Replies within working hours.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {list.map((m, i) => {
              const mine = m.sender_party === "customer";
              const prev = list[i - 1];
              const showStamp = !prev || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 30 * 60_000;
              const atts = (Array.isArray(m.attachments) ? m.attachments : []) as Attachment[];
              return (
                <li key={m.id}>
                  {showStamp && <p className="my-3 text-center text-xs text-subtle">{formatDateTime(m.created_at)}</p>}
                  <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                    {m.body && !(atts.length && /^Sent (\d+ files|.+)$/.test(m.body) && mine) && (
                      <div
                        className={cn(
                          "max-w-[80%] whitespace-pre-wrap rounded-[20px] px-4 py-2.5 text-[15px] leading-relaxed",
                          mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-mist text-ink",
                        )}
                      >
                        {m.body}
                      </div>
                    )}
                    {atts.map((a, j) => {
                      const d = a.documentId ? docById.get(a.documentId) : undefined;
                      const href = d ? urls[d.storage_path] : undefined;
                      const inner = (
                        <>
                          <span className="grid size-10 place-items-center rounded-lg bg-mist text-ink-2">
                            <FileText aria-hidden className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink">{a.name ?? d?.file_name ?? "Document"}</span>
                            <span className="block text-xs text-muted">{[formatBytes(a.size ?? d?.size_bytes), mine ? "Uploaded" : "Shared"].filter(Boolean).join(" · ")}</span>
                          </span>
                        </>
                      );
                      return href ? (
                        <a key={j} href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex max-w-[80%] items-center gap-3 rounded-card border border-line bg-white px-3 py-2.5 hover:bg-mist">
                          {inner}
                        </a>
                      ) : (
                        <div key={j} className="mt-1.5 flex max-w-[80%] items-center gap-3 rounded-card border border-line bg-white px-3 py-2.5">{inner}</div>
                      );
                    })}
                    <p className="mt-1 px-1 text-[11px] text-subtle">
                      {mine ? "You" : m.sender_party === "insurer" ? "Insurer" : m.sender_party === "broker" ? contact?.firstName ?? "Broker" : "Update"} ·{" "}
                      {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(m.created_at))}
                      {mine && lastMine?.id === m.id && (m.read_by_broker_at ? " · Seen" : " · Sent")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/account/requests/${id}`} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-brand-deep hover:bg-mist">View request</Link>
          {!!quoteCount && (
            <Link href={`/account/requests/${id}/quotes`} className="rounded-full border border-line px-4 py-2 text-sm font-medium text-brand-deep hover:bg-mist">Compare quotes</Link>
          )}
        </div>
      </div>

      <Composer requestId={id} userId={user.id} />
    </div>
  );
}
