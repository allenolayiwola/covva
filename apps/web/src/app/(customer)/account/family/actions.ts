"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CONSENT_KINDS, type ConsentKind } from "@im/core";
import type { ActionState } from "@/components/customer/utils";
import { BusinessRuleError } from "@/server/requests";
import { confirmConsent, createBeneficiary, createSponsorship, sendConsentCode, sendGiftNotice, updateBeneficiary, updateSponsorship } from "@/server/diaspora";
import { fileProxyClaim } from "@/server/diaspora-claims";
import { SIGNED_OUT, actionContext } from "../_lib/action";

const uuid = z.string().uuid();
const kindSchema = z.enum(CONSENT_KINDS);

function failure(err: unknown, fallback: string): ActionState {
  if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
  console.error(fallback, err);
  return { ok: false, error: fallback };
}

/** Add a family member (sponsor side). Redirects to the member's page to send the consent code. */
export async function addBeneficiary(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const raw = Object.fromEntries(formData) as Record<string, string>;
  let id: string;
  try {
    const b = await createBeneficiary(supabase, user.id, {
      fullName: raw.full_name,
      relationship: raw.relationship,
      phone: raw.phone,
      email: raw.email,
      dateOfBirth: raw.date_of_birth,
      ghanaCardNumber: raw.ghana_card,
      address: raw.address,
      region: raw.region,
      notes: raw.notes,
    });
    id = b.id;
  } catch (err) {
    if (err instanceof BusinessRuleError && err.code === "invalid_input") {
      // Re-run the schema to map the message to a field for the form.
      const { beneficiarySchema } = await import("@im/core");
      const parsed = beneficiarySchema.safeParse({ fullName: raw.full_name, relationship: raw.relationship, phone: raw.phone, email: raw.email, dateOfBirth: raw.date_of_birth, ghanaCardNumber: raw.ghana_card, address: raw.address, region: raw.region, notes: raw.notes });
      const fe: Record<string, string> = {};
      if (!parsed.success) {
        const map: Record<string, string> = { fullName: "full_name", dateOfBirth: "date_of_birth", ghanaCardNumber: "ghana_card" };
        for (const i of parsed.error.issues) {
          const k = String(i.path[0]);
          fe[map[k] ?? k] ??= i.message;
        }
      }
      return { ok: false, error: err.message, fieldErrors: fe };
    }
    return failure(err, "We couldn't add that family member. Please try again.");
  }
  revalidatePath("/account/family", "layout");
  redirect(`/account/family/beneficiaries/${id}?added=1`);
}

export async function editBeneficiary(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const id = uuid.safeParse(raw.id);
  if (!id.success) return { ok: false, error: "Unknown family member." };
  try {
    await updateBeneficiary(supabase, user.id, id.data, {
      fullName: raw.full_name,
      relationship: raw.relationship as never,
      phone: raw.phone,
      email: raw.email,
      dateOfBirth: raw.date_of_birth,
      ghanaCardNumber: raw.ghana_card || undefined,
      address: raw.address,
      region: raw.region,
      notes: raw.notes,
    });
  } catch (err) {
    return failure(err, "We couldn't save those changes.");
  }
  revalidatePath("/account/family", "layout");
  return { ok: true, message: "Saved." };
}

/** Send the consent code (SMS / WhatsApp) to the beneficiary. */
export async function requestConsent(beneficiaryId: string, kind: string, channel: string): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const id = uuid.safeParse(beneficiaryId);
  const k = kindSchema.safeParse(kind);
  if (!id.success || !k.success) return { ok: false, error: "Unknown consent request." };
  try {
    const r = await sendConsentCode(supabase, user.id, id.data, k.data as ConsentKind, channel === "whatsapp" ? "whatsapp" : "sms");
    revalidatePath(`/account/family/beneficiaries/${id.data}`);
    return {
      ok: true,
      message: r.delivered ? `Code sent to ${r.sentTo}. Ask them to read it to you, or they can tap the link in the message to accept.` : `We couldn't reach ${r.sentTo} just now. Try again in a moment or use the other channel.`,
      data: { expiresAt: r.expiresAt, channel: r.channel, delivered: r.delivered },
    };
  } catch (err) {
    return failure(err, "We couldn't send the code. Please try again.");
  }
}

/** The sponsor types in the code the beneficiary read out. */
export async function confirmConsentCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const id = uuid.safeParse(formData.get("beneficiary_id"));
  const k = kindSchema.safeParse(formData.get("kind"));
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!id.success || !k.success) return { ok: false, error: "Unknown consent request." };
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code.", fieldErrors: { code: "Enter the 6-digit code" } };
  try {
    await confirmConsent(supabase, id.data, k.data as ConsentKind, code);
  } catch (err) {
    return failure(err, "We couldn't confirm that code.");
  }
  revalidatePath("/account/family", "layout");
  return { ok: true, message: "Consent recorded. Thank you." };
}

/** Gift toggle + message + "tell them" preference on a sponsorship. */
export async function saveSponsorshipGift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const id = uuid.safeParse(formData.get("sponsorship_id"));
  if (!id.success) return { ok: false, error: "Unknown sponsorship." };
  const gift = formData.get("gift") === "on";
  try {
    await updateSponsorship(supabase, user.id, id.data, {
      gift,
      giftMessage: gift ? String(formData.get("gift_message") ?? "") : undefined,
      notifyBeneficiary: formData.get("notify_beneficiary") === "on",
    });
  } catch (err) {
    return failure(err, "We couldn't save that.");
  }
  revalidatePath("/account/family", "layout");
  return { ok: true, message: gift ? "Saved as a gift. Hand it over when the policy is issued." : "Saved." };
}

/** Link an existing policy the sponsor already pays for to a beneficiary (creates the sponsorship). */
export async function sponsorExistingPolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const beneficiaryId = uuid.safeParse(formData.get("beneficiary_id"));
  const policyId = uuid.safeParse(formData.get("policy_id"));
  if (!beneficiaryId.success || !policyId.success) return { ok: false, error: "Choose a policy." };
  try {
    await createSponsorship(supabase, user.id, { beneficiaryId: beneficiaryId.data, policyId: policyId.data, gift: formData.get("gift") === "on", giftMessage: String(formData.get("gift_message") ?? "") || undefined });
  } catch (err) {
    return failure(err, "We couldn't link that policy.");
  }
  revalidatePath("/account/family", "layout");
  return { ok: true, message: "Policy linked to this family member." };
}

/** Hand a gift over: the beneficiary gets the reveal link. */
export async function handOverGift(sponsorshipId: string): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const id = uuid.safeParse(sponsorshipId);
  if (!id.success) return { ok: false, error: "Unknown gift." };
  try {
    const r = await sendGiftNotice(supabase, user.id, id.data);
    return r.sent ? { ok: true, message: "We've told them about the gift." } : { ok: true, message: "Saved. They will see the gift when they sign in with their phone number, or when consent is in place for messages." };
  } catch (err) {
    return failure(err, "We couldn't send the gift notice.");
  }
}

const ProxyClaim = z.object({
  policyId: uuid,
  incidentType: z.string().trim().min(1, "Choose what happened").max(40),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened"),
  incidentTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  location: z.string().trim().max(300).optional(),
  description: z.string().trim().min(10, "Describe what happened in a few sentences").max(5000),
  amountClaimed: z.union([z.literal(""), z.coerce.number().positive("Enter an amount above zero")]).optional(),
});

/** Sponsor files a claim on behalf of a beneficiary (needs proxy_claims consent). */
export async function reportProxyClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = ProxyClaim.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your answers.", fieldErrors: fe };
  }
  const v = parsed.data;
  const incidentAt = new Date(`${v.incidentDate}T${v.incidentTime ?? "12:00"}:00Z`);
  if (incidentAt.getTime() > Date.now() + 86_400_000) return { ok: false, error: "The date can't be in the future.", fieldErrors: { incidentDate: "The date can't be in the future" } };
  const { parseUploads } = await import("@/components/customer/utils");
  let claimId: string;
  try {
    const r = await fileProxyClaim(supabase, user.id, v.policyId, {
      incidentType: v.incidentType,
      incidentAt,
      location: v.location || null,
      description: v.description,
      amountClaimed: typeof v.amountClaimed === "number" ? v.amountClaimed : null,
      evidence: parseUploads(formData.get("evidence"), user.id).map((f) => ({ path: f.path, name: f.name, mime: f.mime, size: f.size })),
      source: "web",
    });
    claimId = r.claim.id;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err && typeof (err as { message: unknown }).message === "string") {
      return { ok: false, error: (err as { message: string }).message };
    }
    return failure(err, "We couldn't report the claim. Please try again.");
  }
  revalidatePath("/account", "layout");
  redirect(`/account/claims/${claimId}?reported=1`);
}
