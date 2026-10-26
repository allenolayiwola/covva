"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Enum } from "@im/db";
import { notifyOrg } from "@/server/notify";
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
