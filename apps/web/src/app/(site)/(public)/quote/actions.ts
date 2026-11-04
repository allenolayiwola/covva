"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError, createRequest } from "@/server/requests";
import { createClient } from "@/lib/supabase/server";
import { directOffers } from "@/server/direct-quotes";

const Input = z.object({
  categorySlug: z.string().min(1).max(64),
  risk: z.record(z.string(), z.unknown()),
  brokerIds: z.array(z.string().uuid()).min(1, "Choose at least one broker").max(3, "Choose up to three brokers"),
});

export type SubmitQuoteResult = { ok: true; requestId: string } | { ok: false; error: string; code?: "unauthorised" };

/**
 * Sends the public quote flow's answers as a request. The first chosen broker becomes the broker of record
 * (routed `broker_fixed`); the others are named in the opening message so the broker can obtain quotes from
 * the insurers they represent. A quote request is not cover: nothing is bound here.
 */
export async function submitQuoteRequest(raw: unknown): Promise<SubmitQuoteResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your answers." };
  const input = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Please sign in to send your request.", code: "unauthorised" };

  // The first choice becomes the broker of record through fixed routing, which only checks the organisation is
  // active. Apply the same licence rule as pool routing here: a NIC licence number on file and not expired
  // (the daily licence-status job may not have suspended an expired broker yet).
  const { data: brokers } = await supabase
    .from("organizations")
    .select("id, name, status, nic_licence_number, nic_licence_expires_on")
    .in("id", input.brokerIds)
    .eq("type", "broker");
  const today = new Date(new Date().toISOString().slice(0, 10));
  const eligible = (b: NonNullable<typeof brokers>[number]) =>
    b.status === "active" && !!b.nic_licence_number && (!b.nic_licence_expires_on || new Date(b.nic_licence_expires_on) >= today);
  const chosen = input.brokerIds
    .map((id) => brokers?.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof brokers>[number] => !!b && eligible(b));
  if (!chosen.length) return { ok: false, error: "The brokers you chose can't take new requests right now. Please pick another licensed broker." };
  if (chosen.length < input.brokerIds.length) {
    return { ok: false, error: "One of the brokers you chose can't take new requests right now. Please remove it and try again." };
  }

  let requestId: string;
  try {
    const result = await createRequest(
      { categorySlug: input.categorySlug, risk: input.risk, type: "new_cover", source: "web", brokerOfRecordId: chosen[0]!.id },
      { supabase },
    );
    requestId = result.request.id;
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message, code: err.code === "unauthorised" ? "unauthorised" : undefined };
    console.error("submitQuoteRequest failed", err);
    return { ok: false, error: "We couldn't send your request just now. Your answers are saved on this device — please try again shortly." };
  }

  if (chosen.length > 1) {
    const names = chosen.map((b) => b.name).join(", ");
    await supabase.from("request_messages").insert({
      request_id: requestId,
      sender_id: auth.user.id,
      sender_party: "customer",
      body: `I would like quotes through these brokers: ${names}. ${chosen[0]!.name} is my first choice.`,
    });
  }

  revalidatePath("/account", "layout");
  return { ok: true, requestId };
}

// ---------------------------------------------------------------------------
// Buy directly from an insurer (instant lines only; see server/direct-quotes.ts)
// ---------------------------------------------------------------------------
const OffersInput = z.object({ categorySlug: z.string().min(1).max(64), risk: z.record(z.string(), z.unknown()) });

export type DirectOfferView = { insurerOrgId: string; insurerName: string; productId: string; productName: string; premium: number; issuanceLabel: string };

/** Instant prices from insurers that sell this cover directly. Empty when none apply (complex risk, no rate, refer). */
export async function getDirectOffers(raw: unknown): Promise<DirectOfferView[]> {
  const parsed = OffersInput.safeParse(raw);
  if (!parsed.success) return [];
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const offers = await directOffers(parsed.data.categorySlug, parsed.data.risk, { customerId: auth.user?.id ?? null });
    return offers.map((o) => ({ insurerOrgId: o.insurerOrgId, insurerName: o.insurerName, productId: o.productId, productName: o.productName, premium: o.premium, issuanceLabel: o.issuance.label }));
  } catch (err) {
    console.error("getDirectOffers failed", err);
    return [];
  }
}

const DirectInput = OffersInput.extend({ insurerOrgId: z.string().uuid(), productId: z.string().uuid() });

export type SubmitDirectResult = { ok: true; requestId: string; quoteId: string | null } | { ok: false; error: string; code?: "unauthorised" };

/**
 * Places a direct order with the chosen insurer. Routing sends it `insurer_direct`; an instant line is priced at
 * once (binding quote → straight to checkout). If the price can't be confirmed instantly, the insurer quotes it.
 */
export async function submitDirectOrder(raw: unknown): Promise<SubmitDirectResult> {
  const parsed = DirectInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check your answers." };
  const input = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Please sign in to buy your cover.", code: "unauthorised" };
  try {
    const { request } = await createRequest(
      { categorySlug: input.categorySlug, risk: input.risk, type: "new_cover", source: "web", preferredInsurerOrgId: input.insurerOrgId, preferredProductId: input.productId },
      { supabase },
    );
    const { data: quote } = await supabase
      .from("quotes")
      .select("id")
      .eq("request_id", request.id)
      .eq("status", "ready_to_accept")
      .is("broker_org_id", null)
      .limit(1)
      .maybeSingle();
    revalidatePath("/account", "layout");
    return { ok: true, requestId: request.id, quoteId: quote?.id ?? null };
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message, code: err.code === "unauthorised" ? "unauthorised" : undefined };
    console.error("submitDirectOrder failed", err);
    return { ok: false, error: "We couldn't place your order just now. Your answers are saved on this device — please try again shortly." };
  }
}
