"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildDisclosure } from "@im/core";
import type { Enum } from "@im/db";
import { notifyOrg } from "@/server/notify";
import { emitRequestStatus } from "@/server/webhooks";
import { isOwnUpload, type ActionState, type UploadedFile } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../../_lib/action";

const id = z.string().uuid();
/** Customers may cancel only while a request is waiting on them (RLS + REQUEST_TRANSITIONS). */
const CANCELLABLE: Enum<"request_status">[] = ["draft", "awaiting_customer_info", "quotes_ready"];

async function loadRequest(requestId: string) {
  const ctx = await actionContext();
  if (!ctx.user || !id.safeParse(requestId).success) return { ...ctx, request: null };
  const { data: request } = await ctx.supabase
    .from("requests")
    .select("id, reference, status, broker_org_id, customer_id")
    .eq("id", requestId)
    .eq("customer_id", ctx.user.id)
    .maybeSingle();
  return { ...ctx, request };
}

/** Record an uploaded file against a request (and optionally complete the customer task it answers). */
export async function attachRequestDocument(requestId: string, taskId: string | null, file: UploadedFile): Promise<ActionState> {
  const { supabase, user, request } = await loadRequest(requestId);
  if (!user) return SIGNED_OUT;
  if (!request) return { ok: false, error: "We couldn't find that request." };
  if (!isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid. Please try again." };

  let task: { id: string; title: string; document_kind: Enum<"document_kind"> | null } | null = null;
  if (taskId) {
    if (!id.safeParse(taskId).success) return { ok: false, error: "Unknown task." };
    const { data } = await supabase
      .from("request_tasks")
      .select("id, title, document_kind, status, assignee_party")
      .eq("id", taskId)
      .eq("request_id", request.id)
      .maybeSingle();
    if (!data || data.assignee_party !== "customer") return { ok: false, error: "We couldn't find that task." };
    task = data;
  }

  const { error: docErr } = await supabase.from("documents").insert({
    owner_id: user.id,
    uploaded_by: user.id,
    uploaded_by_party: "customer",
    request_id: request.id,
    task_id: task?.id ?? null,
    kind: task?.document_kind ?? "other",
    storage_path: file.path,
    file_name: file.name.slice(0, 255),
    mime_type: file.mime || null,
    size_bytes: Number.isFinite(file.size) ? file.size : null,
  });
  if (docErr) return { ok: false, error: dbError(docErr, "We couldn't save your document. Please try again.") };

  if (task) {
    await supabase
      .from("request_tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), completed_by: user.id })
      .eq("id", task.id)
      .eq("status", "open");
  }
  await supabase.from("request_events").insert({
    request_id: request.id,
    actor_id: user.id,
    actor_party: "customer",
    event: "document_uploaded",
    note: `${file.name} uploaded${task ? ` for “${task.title}”` : ""}`,
    data: { task_id: task?.id ?? null },
  });

  // When nothing else is needed from the customer, hand the request back to the adviser.
  if (request.status === "awaiting_customer_info") {
    const { count } = await supabase
      .from("request_tasks")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id)
      .eq("assignee_party", "customer")
      .eq("status", "open");
    if (!count) {
      await supabase
        .from("requests")
        .update({ status: "adviser_action", next_step: "Your broker is reviewing what you sent." })
        .eq("id", request.id);
    }
  }

  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "request.document_uploaded",
      title: `Document uploaded on ${request.reference}`,
      body: file.name,
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id },
    }).catch(() => {});
  }

  revalidatePath(`/account/requests/${request.id}`);
  return { ok: true, message: `${file.name} uploaded. Your broker has been told — the insurer is notified only once your broker confirms delivery.` };
}

const CancelInput = z.object({
  requestId: id,
  reason: z.string().trim().max(500).optional(),
});

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CancelInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { supabase, user, request } = await loadRequest(parsed.data.requestId);
  if (!user) return SIGNED_OUT;
  if (!request) return { ok: false, error: "We couldn't find that request." };
  if (!CANCELLABLE.includes(request.status)) {
    return { ok: false, error: "This request can't be cancelled online at this stage. Message your broker and they'll help." };
  }
  const { error } = await supabase
    .from("requests")
    .update({ status: "cancelled", cancelled_reason: parsed.data.reason || "Cancelled by customer", next_step: null })
    .eq("id", request.id);
  if (error) return { ok: false, error: dbError(error, "We couldn't cancel this request. Please message your broker.") };
  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "request.cancelled",
      title: `${request.reference} cancelled by the customer`,
      body: parsed.data.reason || undefined,
      link: `/partner/requests/${request.id}`,
    }).catch(() => {});
    await emitRequestStatus(request.broker_org_id, request, request.status, "cancelled");
  }
  revalidatePath("/account", "layout");
  return { ok: true, message: "Request cancelled." };
}

/** "Notify me" on a quote awaiting underwriting: leaves a visible note for the broker. */
export async function notifyWhenReady(requestId: string, quoteId: string): Promise<ActionState> {
  const { supabase, user, request } = await loadRequest(requestId);
  if (!user) return SIGNED_OUT;
  if (!request || !id.safeParse(quoteId).success) return { ok: false, error: "We couldn't find that quote." };
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, insurer:organizations!quotes_insurer_org_id_fkey(name)")
    .eq("id", quoteId)
    .eq("request_id", request.id)
    .maybeSingle();
  if (!quote) return { ok: false, error: "We couldn't find that quote." };
  const insurer = (quote.insurer as unknown as { name: string } | null)?.name ?? "the insurer";
  const { data: existing } = await supabase
    .from("request_events")
    .select("id")
    .eq("request_id", request.id)
    .eq("event", "notify_requested")
    .contains("data", { quote_id: quoteId })
    .limit(1);
  if (!existing?.length) {
    await supabase.from("request_events").insert({
      request_id: request.id,
      actor_id: user.id,
      actor_party: "customer",
      event: "notify_requested",
      note: `You asked to be told when ${insurer}'s quote is ready to accept.`,
      data: { quote_id: quoteId },
    });
  }
  return { ok: true, message: `We'll notify you when ${insurer}'s quote is ready to accept.` };
}

// ---------------------------------------------------------------------------
// Change of broker of record: the customer's consent. The current broker proposes a
// new broker (task "Confirm your new broker" + `broker_change_proposed` event); the
// customer either records a `broker_change` disclosure for the NEW broker (RLS lets
// customers insert that stage) or declines. Only then can the brokers/platform move it.
// ---------------------------------------------------------------------------
async function loadHandover(requestId: string, taskId: string) {
  const ctx = await loadRequest(requestId);
  if (!ctx.user || !ctx.request || !id.safeParse(taskId).success) return { ...ctx, task: null, proposal: null };
  const [{ data: task }, { data: events }] = await Promise.all([
    ctx.supabase.from("request_tasks").select("id, status, kind, assignee_party, title").eq("id", taskId).eq("request_id", ctx.request.id).maybeSingle(),
    ctx.supabase.from("request_events").select("id, data, created_at").eq("request_id", ctx.request.id).eq("event", "broker_change_proposed").order("created_at", { ascending: false }).limit(1),
  ]);
  const proposal = (events?.[0]?.data as { target_broker_org_id?: string; from_broker_org_id?: string } | null) ?? null;
  const valid = task && task.status === "open" && task.kind === "review" && task.assignee_party === "customer";
  return { ...ctx, task: valid ? task : null, proposal: proposal?.target_broker_org_id ? proposal : null };
}

export async function confirmBrokerChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  if (formData.get("agree") !== "on") return { ok: false, error: "Please tick the box to confirm you understand and agree." };
  const { supabase, user, request, task, proposal } = await loadHandover(requestId, taskId);
  if (!user) return SIGNED_OUT;
  if (!request || !task || !proposal?.target_broker_org_id) return { ok: false, error: "This change of broker is no longer waiting for your answer." };
  const { data: broker } = await supabase.from("organizations").select("id, name, nic_licence_number, type, status").eq("id", proposal.target_broker_org_id).maybeSingle();
  if (!broker || broker.type !== "broker" || broker.status !== "active") return { ok: false, error: "The proposed broker is not available. Message your broker." };
  const text = buildDisclosure({ broker: { name: broker.name, licence: broker.nic_licence_number } });
  const { data: existing } = await supabase.from("broker_disclosures").select("id").eq("request_id", request.id).eq("broker_org_id", broker.id).eq("stage", "broker_change").limit(1);
  if (!existing?.length) {
    const { error } = await supabase.from("broker_disclosures").insert({
      request_id: request.id,
      broker_org_id: broker.id,
      shown_to: user.id,
      method: "in_app",
      stage: "broker_change",
      disclosure_text: `${text} You agreed to ${broker.name} becoming your broker of record for this request.`,
    });
    if (error) return { ok: false, error: dbError(error, "We couldn't record your agreement. Please try again.") };
  }
  await supabase.from("request_tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: user.id }).eq("id", task.id).eq("status", "open");
  await supabase.from("request_events").insert({
    request_id: request.id,
    actor_id: user.id,
    actor_party: "customer",
    event: "broker_change_confirmed",
    note: `You agreed to ${broker.name} becoming your broker of record.`,
    data: { target_broker_org_id: broker.id, task_id: task.id },
  });
  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "request.broker_change",
      title: `Customer agreed to the hand-over of ${request.reference}`,
      body: `${broker.name} can now be made broker of record. Complete the hand-over from the request page.`,
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id, target_broker_org_id: broker.id },
    }, ["owner", "admin", "supervisor"]).catch(() => {});
  }
  revalidatePath(`/account/requests/${request.id}`);
  return { ok: true, message: `Thanks. ${broker.name} will become your broker of record once the hand-over is completed. We'll let you know.` };
}

export async function declineBrokerChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const { supabase, user, request, task, proposal } = await loadHandover(requestId, taskId);
  if (!user) return SIGNED_OUT;
  if (!request || !task) return { ok: false, error: "This change of broker is no longer waiting for your answer." };
  const { error } = await supabase.from("request_tasks").update({ status: "cancelled", completed_at: new Date().toISOString(), completed_by: user.id }).eq("id", task.id).eq("status", "open");
  if (error) return { ok: false, error: dbError(error, "We couldn't record your answer. Please try again.") };
  await supabase.from("request_events").insert({
    request_id: request.id,
    actor_id: user.id,
    actor_party: "customer",
    event: "broker_change_declined",
    note: `You chose to keep your current broker.${reason ? ` Reason: ${reason}` : ""}`,
    data: { target_broker_org_id: proposal?.target_broker_org_id ?? null, task_id: task.id },
  });
  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "request.broker_change",
      title: `Customer declined the hand-over of ${request.reference}`,
      body: reason || "The customer wants to keep you as broker of record.",
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id },
    }, ["owner", "admin", "supervisor"]).catch(() => {});
  }
  revalidatePath(`/account/requests/${request.id}`);
  return { ok: true, message: "Noted. Your current broker stays in charge of this request." };
}
