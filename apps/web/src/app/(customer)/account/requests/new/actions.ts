"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError, createRequest } from "@/server/requests";
import type { ActionState } from "@/components/customer/utils";
import { actionContext } from "../../_lib/action";

const Input = z.object({
  category: z.string().min(1, "Choose a type of cover"),
  type: z.enum(["new_cover", "renewal", "switch", "endorsement"]).default("new_cover"),
  policy: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  risk: z.string().max(20_000),
  note: z.string().trim().max(4000).optional(),
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

  let requestId: string;
  try {
    const result = await createRequest(
      { categorySlug: v.category, risk, type: v.type, relatedPolicyId: v.policy, source: "web" },
      { supabase },
    );
    requestId = result.request.id;
  } catch (err) {
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("createRequest failed", err);
    return { ok: false, error: "We couldn't send your request just now. Your answers are saved on this device — please try again shortly." };
  }

  if (v.note) {
    await supabase.from("request_messages").insert({ request_id: requestId, sender_id: user.id, sender_party: "customer", body: v.note });
  }

  revalidatePath("/account", "layout");
  redirect(`/account/requests/${requestId}?new=1`);
}
