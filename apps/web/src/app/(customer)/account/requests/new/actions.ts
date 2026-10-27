"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError, createRequest } from "@/server/requests";
import { attachBundleRequests } from "@/server/bundles";
import type { ActionState } from "@/components/customer/utils";
import { actionContext } from "../../_lib/action";

const Input = z.object({
  category: z.string().min(1, "Choose a type of cover"),
  type: z.enum(["new_cover", "renewal", "switch", "endorsement"]).default("new_cover"),
  policy: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  risk: z.string().max(20_000),
  note: z.string().trim().max(4000).optional(),
  talk_to_expert: z.string().optional(),
  /** Diaspora: the family member in Ghana this cover is for (empty = myself). */
  beneficiary: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  /** Diaspora bundle slug (e.g. parents-care-pack): the pack's other items become draft requests. */
  bundle: z.string().regex(/^[a-z0-9-]{3,80}$/).optional().or(z.literal("").transform(() => undefined)),
});

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return { ok: false, error: "Your session has ended. Please sign in again." };

  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your answers." };
  const v = parsed.data;

  let risk: Record<string, unknown>;
  try {
    const raw = JSON.parse(v.risk) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("bad");
    risk = raw as Record<string, unknown>;
  } catch {
    return { ok: false, error: "We couldn't read your answers. Please try again." };
  }

  if (v.policy) {
    // Related policy must be the customer's own (RLS would hide anyone else's anyway).
    const { data: pol } = await supabase.from("policies").select("id").eq("id", v.policy).eq("customer_id", user.id).maybeSingle();
    if (!pol) return { ok: false, error: "We couldn't find that policy in your wallet." };
  }

  if (v.beneficiary) {
    // Must be the caller's own beneficiary with consent granted (RLS hides anyone else's).
    const { data: b } = await supabase.from("beneficiaries").select("id, consent_status, full_name").eq("id", v.beneficiary).eq("sponsor_user_id", user.id).maybeSingle();
    if (!b) return { ok: false, error: "We couldn't find that family member. Add them under Family first." };
    if (b.consent_status !== "granted") return { ok: false, error: `${b.full_name} hasn't given consent yet. Send them a consent code from their page under Family.` };
  }

  let requestId: string;
  try {
    const result = await createRequest(
      { categorySlug: v.category, risk, type: v.type, relatedPolicyId: v.policy, source: "web", talkToExpert: v.talk_to_expert === "on", beneficiaryId: v.beneficiary ?? null },
      { supabase },
    );
    requestId = result.request.id;
    if (v.beneficiary) {
      // Draft sponsorship: becomes active when the insurer issues the policy (DB trigger).
      const { createSponsorship } = await import("@/server/diaspora");
      await createSponsorship(supabase, user.id, { beneficiaryId: v.beneficiary, requestId }).catch((err) => console.error("createSponsorship failed", err));
    }
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("createRequest failed", err);
    return { ok: false, error: "We couldn't send your request just now. Your answers are saved on this device — please try again shortly." };
  }

  if (v.note) {
    await supabase.from("request_messages").insert({ request_id: requestId, sender_id: user.id, sender_party: "customer", body: v.note });
  }
  // Voice notes recorded on the form ("Explain what you need"): link them so the broker can listen.
  const voiceIds = formData.getAll("voiceNoteId").map(String);
  if (voiceIds.length) {
    const { linkVoiceNotes } = await import("@/server/voice");
    await linkVoiceNotes(supabase, voiceIds, { requestId }).catch(() => 0);
  }
  // Diaspora bundle: tag this request and save the pack's other items as drafts (server/bundles.ts; never blocks).
  if (v.bundle) await attachBundleRequests({ bundleSlug: v.bundle, primaryRequestId: requestId, customerId: user.id, primaryCategorySlug: v.category, sharedRisk: risk });

  revalidatePath("/account", "layout");
  redirect(`/account/requests/${requestId}?new=1`);
}
