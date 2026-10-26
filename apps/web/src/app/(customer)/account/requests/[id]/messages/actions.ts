"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@im/db";
import { notifyOrg } from "@/server/notify";
import { parseUploads, type ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../../../_lib/action";

const uuid = z.string().uuid();

export async function sendMessage(requestId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(requestId).success) return { ok: false, error: "Unknown conversation." };
  const body = String(formData.get("body") ?? "").trim();
  const uploads = parseUploads(formData.get("attachments"), user.id).slice(0, 5);
  if (!body && !uploads.length) return { ok: false, error: "Write a message or attach a file." };
  if (body.length > 4000) return { ok: false, error: "Messages can be up to 4,000 characters." };

  const { data: request } = await supabase.from("requests").select("id, reference, broker_org_id").eq("id", requestId).eq("customer_id", user.id).maybeSingle();
  if (!request) return { ok: false, error: "We couldn't find that conversation." };

  const attachments: { documentId: string; name: string; size?: number }[] = [];
  for (const f of uploads) {
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        owner_id: user.id,
        uploaded_by: user.id,
        uploaded_by_party: "customer",
        request_id: request.id,
        kind: f.mime.startsWith("image/") ? "photo" : "other",
        storage_path: f.path,
        file_name: f.name.slice(0, 255),
        mime_type: f.mime || null,
        size_bytes: f.size || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: dbError(error, "We couldn't attach your file. Please try again.") };
    attachments.push({ documentId: doc.id, name: f.name, size: f.size });
  }

  const { error } = await supabase.from("request_messages").insert({
    request_id: request.id,
    sender_id: user.id,
    sender_party: "customer",
    body: body || (attachments.length === 1 ? `Sent ${attachments[0]!.name}` : `Sent ${attachments.length} files`),
    attachments: attachments as unknown as Json,
  });
  if (error) return { ok: false, error: dbError(error, "Your message didn't send. Please try again.") };

  if (request.broker_org_id) {
    await notifyOrg(request.broker_org_id, {
      kind: "message.customer",
      title: `New message on ${request.reference}`,
      body: body.slice(0, 140) || "Attachment",
      link: `/partner/requests/${request.id}`,
      data: { request_id: request.id },
    }).catch(() => {});
  }
  revalidatePath(`/account/requests/${request.id}/messages`);
  return { ok: true };
}

/** Read receipts: mark the broker's messages in this thread as read by the customer. */
export async function markThreadRead(requestId: string): Promise<void> {
  const { supabase, user } = await actionContext();
  if (!user || !uuid.safeParse(requestId).success) return;
  const { data: request } = await supabase.from("requests").select("id").eq("id", requestId).eq("customer_id", user.id).maybeSingle();
  if (!request) return;
  await supabase
    .from("request_messages")
    .update({ read_by_customer_at: new Date().toISOString() })
    .eq("request_id", requestId)
    .neq("sender_party", "customer")
    .is("read_by_customer_at", null);
}
