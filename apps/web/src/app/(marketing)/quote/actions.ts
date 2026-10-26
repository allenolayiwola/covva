"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError, createRequest } from "@/server/requests";
import { createClient } from "@/lib/supabase/server";

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
