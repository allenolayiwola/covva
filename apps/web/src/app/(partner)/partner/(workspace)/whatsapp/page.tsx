import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Input, Label, Notice, PageHeader, Pill, Textarea } from "@im/ui";
import { ROLE_STATEMENTS, formatDateTime, withinServiceWindow } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { ActionForm } from "@/components/partner/action-form";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";
import { brokerClose, brokerInfoRequest, brokerReply } from "./actions";

export const metadata: Metadata = { title: "WhatsApp" };

export default function PartnerWhatsAppPage({ searchParams }: PageProps<"/partner/whatsapp">) {
  return (
    <>
      <PageHeader title="WhatsApp" description="Conversations handed to you from Covva's WhatsApp channel. You reply here as the licensed broker: the advice is yours. Free text within 24 hours of the customer's last message; after that, a template re-opens the conversation." />
      <Suspense fallback={<PageSkeleton />}>
        <Conversations searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Conversations({ searchParams }: Pick<PageProps<"/partner/whatsapp">, "searchParams">) {
  const ctx = await requireKind("broker");
  const sp = await searchParams;
  const selected = typeof sp.c === "string" ? sp.c : null;
  const sb = ctx.supabase;
  const { data: conversations } = await sb.from("wa_conversations").select("id, contact_id, status, topic, request_id, policy_id, last_message_at").eq("assigned_org_id", ctx.orgId).order("last_message_at", { ascending: false }).limit(100);
  const rows = conversations ?? [];
  const { data: contacts } = rows.length ? await sb.from("wa_contacts").select("id, phone, display_name, user_id, last_inbound_at, opted_out_at").in("id", rows.map((r) => r.contact_id)) : { data: [] };
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
  const canWork = can(ctx, ROLES.brokerWork);
  const open = rows.filter((r) => r.status === "broker");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <Section title="Handed to you" description={`${open.length} open`}>
        {rows.length === 0 ? (
          <Empty>No WhatsApp conversations have been handed to your organisation yet.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="partner-wa-list">
            {rows.map((r) => {
              const c = contactById.get(r.contact_id);
              return (
                <li key={r.id} className={r.id === selected ? "bg-mist/70" : ""}>
                  <Link href={`/partner/whatsapp?c=${r.id}`} className="block px-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold text-ink">{c?.display_name ?? c?.phone ?? "Customer"}</p>
                      <span className="text-xs text-subtle">{formatDateTime(r.last_message_at)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                      <Pill tone={r.status === "broker" ? "ok" : "neutral"}>{r.status === "broker" ? "with you" : r.status}</Pill>
                      {r.topic && <span className="capitalize">{r.topic.replace(/_/g, " ")}</span>}
                      {c && (c.opted_out_at ? <Pill tone="danger">opted out</Pill> : withinServiceWindow(c.last_inbound_at) ? <Pill tone="ok">window open</Pill> : <Pill tone="wait">template needed</Pill>)}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <div className="space-y-4">
        {selected ? (
          <Suspense fallback={<PageSkeleton rows={4} stats={0} />}>
            <Thread id={selected} orgId={ctx.orgId} canWork={canWork} />
          </Suspense>
        ) : (
          <Notice tone="info">Pick a conversation to read it and reply. {ROLE_STATEMENTS.broker}</Notice>
        )}
      </div>
    </div>
  );
}

async function Thread({ id, orgId, canWork }: { id: string; orgId: string; canWork: boolean }) {
  const ctx = await requireKind("broker");
  const sb = ctx.supabase;
  const { data: conv } = await sb.from("wa_conversations").select("*").eq("id", id).maybeSingle();
  if (!conv || conv.assigned_org_id !== orgId) return <Notice tone="danger">This conversation is not assigned to your organisation.</Notice>;
  const [{ data: contact }, { data: messages }, { data: handoffs }] = await Promise.all([
    sb.from("wa_contacts").select("*").eq("id", conv.contact_id).maybeSingle(),
    sb.from("wa_messages").select("id, direction, kind, body, template_name, status, sender_party, created_at").eq("conversation_id", id).order("created_at").limit(200),
    sb.from("wa_handoffs").select("id, reason, note, created_at, resolved_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  const windowOpen = withinServiceWindow(contact?.last_inbound_at ?? null);
  const optedOut = !!contact?.opted_out_at;
  const active = conv.status === "broker";
  const customerLink = contact?.user_id ? `/partner/customers?c=${contact.user_id}` : null;

  return (
    <>
      <Section
        title={contact?.display_name ?? contact?.phone ?? "Customer"}
        description={
          <>
            {contact?.phone} · {customerLink ? <Link href={customerLink} className="text-brand hover:underline">customer record</Link> : "not linked to a Covva account"} · {optedOut ? <span className="text-danger">opted out</span> : windowOpen ? <span className="text-brand-deep">24h window open</span> : <span className="text-amber">window closed</span>}
            {conv.request_id && <> · <Link href={`/partner/requests/${conv.request_id}`} className="text-brand hover:underline">request</Link></>}
          </>
        }
        actions={
          active ? (
            <ActionForm action={brokerClose} inline submitLabel="Close conversation" variant="outline" confirm="Close this conversation? The customer can message again at any time.">
              <input type="hidden" name="conversationId" value={conv.id} />
            </ActionForm>
          ) : (
            <Pill>{conv.status}</Pill>
          )
        }
      >
        {handoffs?.[0] && (
          <Notice tone="info" className="mb-3">
            Handed over: <span className="capitalize">{handoffs[0].reason.replace(/_/g, " ")}</span>{handoffs[0].note ? ` — ${handoffs[0].note}` : ""} ({formatDateTime(handoffs[0].created_at)})
          </Notice>
        )}
        <ol className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" data-testid="partner-wa-thread">
          {(messages ?? []).map((m) => (
            <li key={m.id} className={m.direction === "in" ? "flex justify-start" : "flex justify-end"}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === "in" ? "bg-mist text-ink" : m.sender_party === "broker" ? "bg-brand text-white" : "bg-info-bg text-ink"}`}>
                <p className="whitespace-pre-wrap">{m.body ?? `[${m.kind}]`}</p>
                <p className={`mt-1 text-[11px] ${m.sender_party === "broker" && m.direction === "out" ? "text-white/70" : "text-subtle"}`}>{m.direction === "in" ? "customer" : (m.sender_party ?? "covva")} · {m.status} · {formatDateTime(m.created_at)}</p>
              </div>
            </li>
          ))}
          {!messages?.length && <li className="text-sm text-muted">No messages yet.</li>}
        </ol>
      </Section>
      {active && canWork && !optedOut && (
        <Section title={windowOpen ? "Reply" : "Re-open with a template"} description={windowOpen ? "You are replying as the licensed broker; the advice you give is yours. Never ask for PINs or card details." : "The 24-hour window has closed. The info request template tells the customer what you need and invites them to reply."}>
          {windowOpen ? (
            <ActionForm action={brokerReply} submitLabel="Send on WhatsApp" resetOnSuccess>
              <input type="hidden" name="conversationId" value={conv.id} />
              <Label htmlFor="wa-reply">Message</Label>
              <Textarea id="wa-reply" name="text" required maxLength={4000} className="min-h-24" />
            </ActionForm>
          ) : (
            <ActionForm action={brokerInfoRequest} submitLabel="Send template" resetOnSuccess>
              <input type="hidden" name="conversationId" value={conv.id} />
              <Label htmlFor="wa-ref">Reference</Label>
              <Input id="wa-ref" name="reference" required maxLength={60} placeholder="REQ-1234" />
              <Label htmlFor="wa-what">What you need</Label>
              <Input id="wa-what" name="what" required maxLength={300} placeholder="a photo of your driver's licence" />
            </ActionForm>
          )}
        </Section>
      )}
      {active && optedOut && <Notice tone="wait">The customer opted out of WhatsApp. Reach them through the request messages or by phone.</Notice>}
      <p className="text-xs text-subtle">{ROLE_STATEMENTS.broker} {ROLE_STATEMENTS.platform}</p>
    </>
  );
}
