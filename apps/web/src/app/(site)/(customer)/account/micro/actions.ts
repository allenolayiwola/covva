"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { buyMicroCover, renewMicro, setMicroAutoRenew } from "@/server/micro";
import { normaliseGhanaPhone, type ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext } from "../_lib/action";

const uuid = z.string().uuid();
const BuyInput = z.object({
  version: uuid,
  period: z.enum(["day", "week", "month"], { error: "Choose a day, a week or a month" }),
  method: z.enum(["mtn", "vod", "atl", "card"], { error: "Choose how to pay" }),
  phone: z.string().optional(),
  auto_renew: z.string().optional(),
});

function fail(err: unknown, fallback: string): ActionState {
  if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
  console.error("micro action failed", err);
  return { ok: false, error: fallback };
}

/** 3-tap purchase: period → MoMo number → pay. */
export async function buyMicro(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = BuyInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const phone = v.method === "card" ? null : normaliseGhanaPhone(v.phone);
  if (v.method !== "card" && !phone) return { ok: false, error: "Enter the mobile money number.", fieldErrors: { phone: "Enter the mobile money number, e.g. 024 123 4567" } };
  try {
    const r = await buyMicroCover(user.id, v.version, v.period, "web", { payment: v.method === "card" ? "card" : "mobile_money", momo: phone && v.method !== "card" ? { phone, network: v.method } : null, autoRenew: v.auto_renew === "on" });
    revalidatePath("/account/micro");
    if (r.mode === "routed") return { ok: true, message: `Request sent. ${r.nextStep}`, data: { next: `/account/requests/${r.requestId}` } };
    if (r.payment.authorizationUrl) return { ok: true, message: "Opening the payment page…", data: { url: r.payment.authorizationUrl } };
    return { ok: true, message: r.payment.status === "succeeded" ? "Paid. Your cover is being issued." : r.payment.displayText ?? "Approve the prompt on your phone to pay.", data: { next: "/account/micro" } };
  } catch (err) {
    return fail(err, "We couldn't start the payment. No money has been taken.");
  }
}

export async function renewMicroNow(policyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Not found." };
  const method = String(formData.get("method") ?? "mtn");
  const phone = normaliseGhanaPhone(String(formData.get("phone") ?? ""));
  if (method !== "card" && !phone) return { ok: false, error: "Enter the mobile money number.", fieldErrors: { phone: "Enter the mobile money number" } };
  try {
    const r = await renewMicro(policyId, user.id, method === "card" ? { channel: "card", sessionChannel: "web" } : { channel: "mobile_money", momo: { phone: phone!, network: method as "mtn" | "vod" | "atl" }, sessionChannel: "web" });
    revalidatePath("/account/micro");
    if (r.authorizationUrl) return { ok: true, message: "Opening the payment page…", data: { url: r.authorizationUrl } };
    return { ok: true, message: r.status === "succeeded" ? "Renewed." : r.displayText ?? "Approve the prompt on your phone to pay." };
  } catch (err) {
    return fail(err, "We couldn't start the renewal. No money has been taken.");
  }
}

export async function toggleAutoRenew(policyId: string, on: boolean): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Not found." };
  try {
    await setMicroAutoRenew(policyId, user.id, on);
    revalidatePath("/account/micro");
    return { ok: true, message: on ? "Auto-renew is on." : "Auto-renew is off." };
  } catch (err) {
    return fail(err, "We couldn't update auto-renew.");
  }
}
