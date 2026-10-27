"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRIVACY_REQUEST_TYPES, PRIVACY_REQUEST_TYPE_LIST, formatDate } from "@im/core";
import type { ActionState } from "@/components/customer/utils";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyOrg } from "@/server/notify";
import { log } from "@/server/log";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";

const Submit = z.object({
  type: z.enum(PRIVACY_REQUEST_TYPE_LIST, { error: "Choose what you would like us to do" }),
  note: z.string().trim().max(2000, "Please keep your note under 2,000 characters").optional(),
});

/** Make an Act 843 request. Validation is repeated in public.submit_privacy_request (P0001 messages). */
export async function submitPrivacyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Submit.safeParse({ type: formData.get("type") ?? undefined, note: formData.get("note") ?? undefined });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fe };
  }
  const { type, note } = parsed.data;
  if (PRIVACY_REQUEST_TYPES[type].noteRequired && (note?.length ?? 0) < 10) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { note: PRIVACY_REQUEST_TYPES[type].notePrompt } };
  }

  const { data, error } = await supabase.rpc("submit_privacy_request", { p_type: type, p_note: note || undefined, p_channel: "web" });
  if (error) return { ok: false, error: dbError(error, "We couldn't send your request. Please try again.") };
  const created = (data ?? {}) as { id?: string; reference?: string; status?: string; due_at?: string };

  // Tell the privacy officers (in-app + email). Marketing opt-outs are already done, so they are not paged for those.
  if (type !== "marketing_opt_out" && created.id) {
    try {
      const svc = createServiceClient();
      const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
      const adminBase = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
      if (platform) {
        await notifyOrg(
          platform.id,
          {
            kind: "privacy.request.submitted",
            title: `New privacy request ${created.reference ?? ""}: ${PRIVACY_REQUEST_TYPES[type].label}`.trim(),
            body: created.due_at ? `Answer by ${formatDate(created.due_at)}.` : undefined,
            link: `${adminBase}/privacy-requests/${created.id}`,
            data: { privacy_request_id: created.id, type },
            channels: ["in_app", "email"],
          },
          ["platform_admin", "compliance", "platform_ops"],
        );
      }
    } catch (err) {
      log.warn("privacy.notify_staff_failed", { err });
    }
  }

  revalidatePath("/account/privacy");
  revalidatePath("/account/profile");
  if (type === "marketing_opt_out") {
    return { ok: true, message: "Done — marketing is switched off. You'll still get messages about your cover, quotes and claims." };
  }
  return {
    ok: true,
    message: `Request ${created.reference ?? ""} received. We'll reply by ${created.due_at ? formatDate(created.due_at) : "the date shown below"}.`.replace("  ", " "),
  };
}

export async function withdrawPrivacyRequest(id: string): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "We could not find that request." };
  const { error } = await supabase.rpc("withdraw_privacy_request", { p_id: id });
  if (error) return { ok: false, error: dbError(error, "We couldn't withdraw this request.") };
  revalidatePath("/account/privacy");
  return { ok: true, message: "Request withdrawn." };
}
