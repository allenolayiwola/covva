"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { payInstalment, reinstate, type CollectArgs, type CollectResult } from "@/server/instalments";
import { normaliseGhanaPhone, type ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();
const Method = z.enum(["mtn", "vod", "atl", "card"]);

function collectArgs(formData: FormData): CollectArgs | ActionState {
  const method = Method.safeParse(formData.get("method"));
  if (!method.success) return { ok: false, error: "Choose how to pay." };
  if (method.data === "card") return { channel: "card" };
  const phone = normaliseGhanaPhone(String(formData.get("phone") ?? ""));
  if (!phone) return { ok: false, error: "Enter the mobile money number.", fieldErrors: { phone: "Enter the mobile money number, e.g. 024 123 4567" } };
  return { channel: "mobile_money", momo: { phone, network: method.data } };
}

function done(r: CollectResult, extra = ""): ActionState {
  revalidatePath("/account/payments/instalments");
  if (r.authorizationUrl) return { ok: true, message: "Opening the payment page…", data: { url: r.authorizationUrl } };
  if (r.status === "succeeded") return { ok: true, message: `Paid. ${extra}`.trim() };
  return { ok: true, message: `${r.displayText ?? "Approve the prompt on your phone to pay."} ${extra}`.trim() };
}

async function guard(id: string, formData: FormData, fn: (userId: string, args: CollectArgs) => Promise<ActionState>): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Not found." };
  const args = collectArgs(formData);
  if ("ok" in args) return args;
  try {
    return await fn(user.id, args);
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("instalment action failed", err);
    return { ok: false, error: "We couldn't start the payment. No money has been taken." };
  }
}

export async function payInstalmentNow(instalmentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(instalmentId, formData, async (userId, args) => done(await payInstalment(instalmentId, userId, args)));
}

export async function reinstateSchedule(scheduleId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(scheduleId, formData, async (userId, args) => {
    const r = await reinstate(scheduleId, userId, args);
    return done(r, r.requiresReview ? "Once paid, the insurer reviews the reinstatement." : "Cover resumes once the payment is confirmed.");
  });
}
