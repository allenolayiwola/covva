"use server";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { TELEMATICS_CONSENT_VERSION } from "@im/core";
import type { ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";

const Enrol = z.object({
  policyId: z.string().uuid(),
  deviceLabel: z.string().trim().max(80).optional(),
  agree: z.literal("on", { error: "Please tick the box to agree before enrolling" }),
});

/** Record the telematics consent (append-only consents row) and enrol the policy through the RPC. */
export async function enrolInTelematics(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Enrol.safeParse({ policyId: formData.get("policyId"), deviceLabel: formData.get("deviceLabel") || undefined, agree: formData.get("agree") ?? undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const h = await headers();
  const { error: cErr } = await supabase.from("consents").insert({
    user_id: user.id,
    type: "telematics",
    granted: true,
    version: TELEMATICS_CONSENT_VERSION,
    context: "web",
    user_agent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (cErr) return { ok: false, error: dbError(cErr, "We couldn't record your consent. Please try again.") };
  // The web enrolment has no phone yet: the app links the device when it first uploads trips.
  const { error } = await supabase.rpc("enrol_telematics", { p_policy_id: parsed.data.policyId, p_device_id: `web-${user.id.slice(0, 8)}-${Date.now().toString(36)}`, p_device_label: parsed.data.deviceLabel || "Covva app (to be linked)" });
  if (error) return { ok: false, error: dbError(error, "We couldn't enrol this policy.") };
  refresh();
  return { ok: true, message: "You're enrolled. Open the Covva app on your phone to start recording trips; your first score appears after a month with at least 5 trips." };
}

const Withdraw = z.object({ enrolmentId: z.string().uuid(), reason: z.string().trim().max(200).optional() });

/** Stop collection (database guard refuses further trips) and record the consent withdrawal. */
export async function withdrawFromTelematics(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Withdraw.safeParse({ enrolmentId: formData.get("enrolmentId"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return { ok: false, error: "Please check the form." };
  const { error } = await supabase.rpc("withdraw_telematics", { p_enrolment_id: parsed.data.enrolmentId, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: dbError(error, "We couldn't stop driving scoring just now.") };
  refresh();
  return { ok: true, message: "Driving scoring stopped. No more trips will be accepted; your trip summaries are deleted within the retention period and your monthly scores stay with the policy." };
}
