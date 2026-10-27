import { Suspense } from "react";
import Link from "next/link";
import { Label, PageHeader, Pill, Select, Tabs, Textarea } from "@im/ui";
import { withinServiceWindow } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, profileMap, personName, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { LoadingBlock, Panel } from "@/components/ui/layout";
import { assignToBroker, backToBot, closeConversation, replyText, replyTemplate, resolveHandoff, takeOver } from "./actions";
import { SubNav } from "./sub-nav";
import { TemplateReplyForm } from "./template-reply-form";

export default function WhatsAppPage({ searchParams }: PageProps<"/whatsapp">) {
  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Support inbox for the WhatsApp Business channel. The assistant answers FAQs; anything advisory goes to the customer's broker, complaints and payment problems come here. Free text only within 24 hours of the customer's last message — otherwise templates."
        actions={<SubNav active="inbox" />}
      />
      <Suspense fallback={<LoadingBlock label="Loading conversations…" />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TABS = [
  { key: "bot", label: "With the assistant" },
  { key: "human", label: "With support" },
  { key: "broker", label: "With a broker" },
  { key: "closed", label: "Closed" },
] as const;

const STATUS_TONE = { bot: "info", human: "wait", broker: "ok", closed: "neutral" } as const;

async function Inbox({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const status = (sp(params, "status") ?? "human") as (typeof STATUS_TABS)[number]["key"];
  const selected = sp(params, "c");
  const writer = can(staff.roles, "whatsapp");

  const [{ data: conversations, error }, { data: counts }, { data: optOuts }] = await Promise.all([
    supabase.from("wa_conversations").select("id, contact_id, status, assigned_org_id, assigned_user_id, topic, bot_turns, last_message_at, created_at").eq("status", status).order("last_message_at", { ascending: false }).limit(100),
    supabase.from("wa_conversations").select("status").neq("status", "closed"),
    supabase.from("wa_contacts").select("id, phone, display_name, opted_out_at").not("opted_out_at", "is", null).order("opted_out_at", { ascending: false }).limit(8),
  ]);
  const rows = conversations ?? [];
  const tally = (counts ?? []).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const { data: contacts } = contactIds.length ? await supabase.from("wa_contacts").select("id, phone, display_name, user_id, last_inbound_at, opted_out_at").in("id", contactIds) : { data: [] };
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
  const orgs = await orgMap(supabase);
  const people = await profileMap(supabase, rows.map((r) => r.assigned_user_id));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Tabs active={status} items={STATUS_TABS.map((t) => ({ key: t.key, label: t.label, href: `/whatsapp?status=${t.key}${selected ? `&c=${selected}` : ""}`, count: t.key === "closed" ? undefined : (tally[t.key] ?? 0) }))} />
        {error && <p className="text-sm text-danger">{error.message}</p>}
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white" data-testid="wa-inbox">
          {rows.map((r) => {
            const c = contactById.get(r.contact_id);
            const open = withinServiceWindow(c?.last_inbound_at ?? null);
            return (
              <li key={r.id} className={r.id === selected ? "bg-mist/70" : "hover:bg-mist/40"}>
                <Link href={`/whatsapp?status=${status}&c=${r.id}`} className="block px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-ink">{c?.display_name ?? c?.phone ?? "Unknown"}</p>
                    <span className="shrink-0 text-xs text-subtle">{formatDateTime(r.last_message_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Pill tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>{r.status}</Pill>
                    {r.topic && <span className="capitalize">{r.topic.replace(/_/g, " ")}</span>}
                    {r.assigned_org_id && <span>· {orgs.get(r.assigned_org_id)?.name}</span>}
                    {r.assigned_user_id && <span>· {personName(people.get(r.assigned_user_id))}</span>}
                    {c?.opted_out_at ? <Pill tone="danger">Opted out</Pill> : open ? <Pill tone="ok">Window open</Pill> : <Pill tone="wait">Templates only</Pill>}
                    {c?.user_id ? <span>· linked account</span> : <span>· unknown number</span>}
                  </div>
                </Link>
              </li>
            );
          })}
          {!rows.length && <li className="px-4 py-10 text-center text-sm text-muted">No conversations here.</li>}
        </ul>
        <Panel title="Recent opt-outs" description="Contacts who sent STOP. Nothing is sent to them until they message again.">
          {optOuts?.length ? (
            <ul className="space-y-1 text-sm">
              {optOuts.map((c) => (
                <li key={c.id} className="flex justify-between gap-2"><span>{c.display_name ?? c.phone}</span><span className="text-xs text-subtle">{formatDateTime(c.opted_out_at!)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No opt-outs yet.</p>
          )}
          <p className="mt-2 text-xs"><Link href="/whatsapp/contacts?optout=1" className="text-brand hover:underline">All opted-out contacts</Link></p>
        </Panel>
      </div>
      <div>
        {selected ? (
          <Suspense fallback={<LoadingBlock label="Loading conversation…" />}>
            <Conversation id={selected} writer={writer} staffId={staff.userId} />
          </Suspense>
        ) : (
          <div className="rounded-card border border-dashed border-line p-10 text-center text-sm text-muted">Select a conversation to read it, take it over or reply.</div>
        )}
      </div>
    </div>
  );
}

async function Conversation({ id, writer, staffId }: { id: string; writer: boolean; staffId: string }) {
  const supabase = await createClient();
  const { data: conv } = await supabase.from("wa_conversations").select("*").eq("id", id).maybeSingle();
  if (!conv) return <p className="text-sm text-danger">Conversation not found.</p>;
  const [{ data: contact }, { data: messages }, { data: handoffs }, { data: templates }, { data: brokers }] = await Promise.all([
    supabase.from("wa_contacts").select("*").eq("id", conv.contact_id).maybeSingle(),
    supabase.from("wa_messages").select("id, direction, kind, body, template_name, status, error, sender_party, created_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(200),
    supabase.from("wa_handoffs").select("id, reason, to_party, org_id, complaint_id, lead_id, note, created_at, resolved_at").eq("conversation_id", id).order("created_at", { ascending: false }),
    supabase.from("wa_templates").select("name, status, body, variables, description").order("name"),
    supabase.from("organizations").select("id, name").eq("type", "broker").eq("status", "active").order("name"),
  ]);
  const orgs = await orgMap(supabase);
  const profile = contact?.user_id ? (await profileMap(supabase, [contact.user_id])).get(contact.user_id) : null;
  const windowOpen = withinServiceWindow(contact?.last_inbound_at ?? null);
  const optedOut = !!contact?.opted_out_at;
  const mine = conv.assigned_user_id === staffId;

  return (
    <div className="space-y-4" data-testid="wa-conversation">
      <Panel
        title={contact?.display_name ?? contact?.phone ?? "Conversation"}
        description={
          <>
            {contact?.phone} · {profile ? <Link href={`/users/${contact!.user_id}`} className="text-brand hover:underline">{personName(profile)}</Link> : "not linked to an account"} · status <strong className="capitalize">{conv.status}</strong>
            {conv.assigned_org_id && <> · {orgs.get(conv.assigned_org_id)?.name}</>}
            {" · "}
            {optedOut ? <span className="text-danger">opted out</span> : windowOpen ? <span className="text-brand">24h window open until {formatDateTime(new Date(Date.parse(contact!.last_inbound_at!) + 24 * 3600 * 1000).toISOString())}</span> : <span className="text-amber">window closed — templates only</span>}
          </>
        }
        actions={
          <>
            {conv.status !== "closed" && !mine && (
              <ActionForm action={takeOver} inline submitLabel={conv.status === "human" ? "Reassign to me" : "Take over"} readOnly={!writer} audited={false}>
                <input type="hidden" name="conversationId" value={conv.id} />
              </ActionForm>
            )}
            {conv.status !== "bot" && conv.status !== "closed" && (
              <ActionForm action={backToBot} inline submitLabel="Back to assistant" submitVariant="outline" readOnly={!writer} audited={false}>
                <input type="hidden" name="conversationId" value={conv.id} />
              </ActionForm>
            )}
            {conv.status !== "closed" && (
              <ConfirmAction action={closeConversation} fields={{ conversationId: conv.id }} label="Close" title="Close this conversation" body="Open handoffs are marked resolved. The customer can always start a new conversation by messaging again." confirmLabel="Close conversation" variant="danger" disabled={!writer} />
            )}
          </>
        }
      >
        <ol className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {(messages ?? []).map((m) => (
            <li key={m.id} className={m.direction === "in" ? "flex justify-start" : "flex justify-end"}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === "in" ? "bg-mist text-ink" : m.sender_party === "bot" ? "bg-info-bg text-ink" : "bg-brand text-white"}`}>
                <p className="whitespace-pre-wrap">{m.body ?? `[${m.kind}]`}</p>
                <p className={`mt-1 text-[11px] ${m.direction === "in" ? "text-subtle" : m.sender_party === "bot" ? "text-muted" : "text-white/70"}`}>
                  {m.direction === "in" ? "customer" : (m.sender_party ?? "system")} · {m.kind}{m.template_name ? ` (${m.template_name})` : ""} · {m.status}{m.error ? ` · ${m.error}` : ""} · {formatDateTime(m.created_at)}
                </p>
              </div>
            </li>
          ))}
          {!messages?.length && <li className="text-sm text-muted">No messages yet.</li>}
        </ol>
      </Panel>

      {conv.status !== "closed" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Reply" description={optedOut ? "Opted out: nothing can be sent." : windowOpen ? "Free text (the window is open)." : "Window closed: use a template."}>
            {!optedOut && windowOpen ? (
              <ActionForm action={replyText} submitLabel="Send" readOnly={!writer} audited={false}>
                <input type="hidden" name="conversationId" value={conv.id} />
                <Label htmlFor="reply-text">Message</Label>
                <Textarea id="reply-text" name="text" required minLength={1} maxLength={4000} className="min-h-24" placeholder="Reply as Covva support. No advice, no prices — hand advisory questions to the broker." />
              </ActionForm>
            ) : !optedOut ? (
              <TemplateReplyForm action={replyTemplate} conversationId={conv.id} templates={(templates ?? []).map((t) => ({ name: t.name, status: t.status, body: t.body, variables: t.variables, description: t.description }))} readOnly={!writer} />
            ) : (
              <p className="text-sm text-muted">The contact sent STOP on {formatDateTime(contact!.opted_out_at!)}.</p>
            )}
          </Panel>
          <Panel title="Hand to a broker" description="Advice, suitability and claims help belong to the licensed broker. The customer's broker of record is pre-selected when known.">
            <ActionForm action={assignToBroker} submitLabel="Hand over" submitVariant="outline" readOnly={!writer} audited={false}>
              <input type="hidden" name="conversationId" value={conv.id} />
              <Label htmlFor="assign-org">Broker organisation</Label>
              <Select id="assign-org" name="orgId" defaultValue={conv.assigned_org_id ?? ""} required>
                <option value="" disabled>Choose a broker…</option>
                {(brokers ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
              <Label htmlFor="assign-reason">Reason</Label>
              <Select id="assign-reason" name="reason" defaultValue="advice">
                <option value="advice">Advice / suitability</option>
                <option value="claim">Claim help</option>
                <option value="requested">Customer asked for their broker</option>
                <option value="unknown">Other</option>
              </Select>
              <Label htmlFor="assign-note">Note for the broker</Label>
              <Textarea id="assign-note" name="note" maxLength={500} className="min-h-16" />
            </ActionForm>
          </Panel>
        </div>
      )}

      <Panel title="Handoff history" description="Why the conversation left the assistant and who received it.">
        {handoffs?.length ? (
          <ul className="divide-y divide-line text-sm">
            {handoffs.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p>
                    <span className="capitalize">{h.reason.replace(/_/g, " ")}</span> → {h.to_party === "broker" ? (h.org_id ? orgs.get(h.org_id)?.name ?? "broker" : "broker") : "support"}
                    {h.complaint_id && <> · <Link href={`/complaints/${h.complaint_id}`} className="text-brand hover:underline">complaint</Link></>}
                    {h.lead_id && <> · <Link href="/leads" className="text-brand hover:underline">callback lead</Link></>}
                  </p>
                  {h.note && <p className="text-xs text-muted">{h.note}</p>}
                  <p className="text-xs text-subtle">{formatDateTime(h.created_at)}{h.resolved_at ? ` · resolved ${formatDateTime(h.resolved_at)}` : ""}</p>
                </div>
                {!h.resolved_at && (
                  <ActionForm action={resolveHandoff} inline submitLabel="Resolve" submitVariant="ghost" readOnly={!writer} audited={false}>
                    <input type="hidden" name="handoffId" value={h.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No handoffs.</p>
        )}
      </Panel>
    </div>
  );
}
