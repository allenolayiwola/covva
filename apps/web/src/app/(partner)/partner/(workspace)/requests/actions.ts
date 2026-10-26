"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { riskFingerprint, riskTitle, type RiskField } from "@im/core";
import type { Json } from "@im/db";
import { notify } from "@/server/notify";
import { riskFromForm } from "@/components/partner/risk-fields";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";
import { findCustomer } from "../../_lib/privileged";

const Input = z.object({
  customer: z.string().trim().min(3, "Enter the customer's email or phone"),
  categoryId: z.string().uuid("Choose a category"),
  type: z.enum(["new_cover", "renewal", "switch", "endorsement", "service"]),
  channel: z.enum(["call", "visit", "email", "whatsapp"]).default("call"),
  note: z.string().trim().max(2000).optional(),
});

/** Assisted request on behalf of an existing customer (RLS insert as a broker member). */
export async function createAssistedRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const parsed = Input.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const input = parsed.data;

    const found = await findCustomer(input.customer);
    if (found === "unavailable") return { ok: false, error: "Customer lookup is unavailable right now. Ask the customer to start the request in the app, or contact platform support." };
    if (!found) return { ok: false, data: { invite: true } };

    const { data: category } = await ctx.supabase.from("product_categories").select("id, slug, name, availability, risk_schema").eq("id", input.categoryId).single();
    if (!category) return { ok: false, error: "Unknown category." };
    if (category.availability === "planned") return { ok: false, error: `${category.name} is planned and not yet available.` };

    const risk = riskFromForm(formData, (category.risk_schema ?? []) as unknown as RiskField[]);
    const fingerprint = await riskFingerprint({ customerId: found.id, categorySlug: category.slug, risk });

    const { data: req, error } = await ctx.supabase
      .from("requests")
      .insert({
        customer_id: found.id,
        category_id: category.id,
        type: input.type,
        status: "submitted",
        source: "call_centre",
        title: riskTitle(category.slug, risk),
        broker_org_id: ctx.orgId,
        assigned_to: ctx.userId,
        team: ctx.membership.team,
        risk_data: risk as Json,
        risk_fingerprint: fingerprint,
        needs_adviser_review: true,
        next_step: "Your broker is preparing your request. They may ask you for documents.",
      })
      .select("id, reference")
      .single();
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create the request.") };

    await ctx.supabase.from("request_events").insert({
      request_id: req.id,
      actor_id: ctx.userId,
      actor_party: "broker",
      event: "note",
      note: `Assisted request created (${input.channel.replace("_", " ")}).${input.note ? ` ${input.note}` : ""}`,
      visible_to_customer: false,
    });

    await notify({
      userId: found.id,
      kind: "request.created",
      title: `${ctx.orgName} opened request ${req.reference} for you`,
      body: `Your ${category.name.toLowerCase()} request is with your broker of record, ${ctx.orgName}. Please check it and add anything missing.`,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id },
    });

    refresh();
    return { ok: true, message: `${req.reference} created for ${found.name ?? "the customer"} and assigned to you.`, data: { requestId: req.id } };
  });
}
