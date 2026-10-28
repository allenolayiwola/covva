"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isEndorsementKind } from "@im/core";
import type { ActionState } from "@/components/customer/utils";
import { acceptEndorsement, cancelEndorsement, startEndorsement } from "@/server/endorsements";
import { BusinessRuleError } from "@/server/requests";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();
const RESERVED = new Set(["kind", "effective_from"]);

/** "Make a change" on a policy: structured endorsement request (validated per kind in the server module). */
export async function requestPolicyChange(policyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Unknown policy." };
  const kind = String(formData.get("kind") ?? "");
  if (!isEndorsementKind(kind)) return { ok: false, error: "Choose what you want to change." };
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const changes: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !RESERVED.has(k) && !k.startsWith("$")) changes[k] = v.trim();
  let id: string;
  try {
    const r = await startEndorsement(user.id, policyId, kind, changes, effectiveFrom, { source: "web" });
    id = r.endorsement.id;
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't send your change. Please try again." };
  }
  revalidatePath(`/account/policies/${policyId}`);
  redirect(`/account/policies/${policyId}/changes/${id}?sent=1`);
}

/** Agree to the quoted change in premium; additional premium goes to the insurer's checkout. */
export async function agreeToPolicyChange(policyId: string, endorsementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success || !uuid.safeParse(endorsementId).success) return { ok: false, error: "Unknown change." };
  const channel = formData.get("channel") === "card" ? "card" : formData.get("channel") === "bank_transfer" ? "bank_transfer" : "mobile_money";
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  let url: string | null = null;
  try {
    const r = await acceptEndorsement(user.id, endorsementId, { channel, callbackUrl: site ? `${site}/account/policies/${policyId}/changes/${endorsementId}?paid=1` : undefined });
    url = r.payment?.authorizationUrl ?? null;
    if (r.payment && !url && r.payment.displayText) {
      revalidatePath(`/account/policies/${policyId}/changes/${endorsementId}`);
      return { ok: true, message: r.payment.displayText };
    }
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't record your answer. Please try again." };
  }
  revalidatePath(`/account/policies/${policyId}/changes/${endorsementId}`);
  if (url) redirect(url as never);
  return { ok: true, message: "Thank you. Your insurer will now confirm the change." };
}

export async function withdrawPolicyChange(policyId: string, endorsementId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(endorsementId).success) return { ok: false, error: "Unknown change." };
  try {
    await cancelEndorsement({ endorsementId, actorId: user.id, reason: String(formData.get("reason") ?? "").slice(0, 500) || null, db: supabase });
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't withdraw the change." };
  }
  revalidatePath(`/account/policies/${policyId}/changes/${endorsementId}`);
  return { ok: true, message: "Change withdrawn. Your cover continues unchanged." };
}
