"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { referralCode } from "@im/core";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const Create = z.object({
  campaign: z.string().trim().min(2, "Name the campaign (e.g. “Showroom QR”)").max(80),
  landing: z.string().trim().max(200).optional().transform((v) => (v ? (v.startsWith("/") ? v : `/${v}`) : "/")).refine((v) => !v.startsWith("//") && !/[\\\s]/.test(v), "Use a path on Covva like /insurance/motor"),
});

export async function createCampaignLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "distributor", roles: ROLES.orgAdmin });
    const parsed = Create.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
    const { error } = await ctx.supabase.rpc("create_partner_referral_link", { p_org_id: ctx.orgId, p_campaign: parsed.data.campaign, p_landing_path: parsed.data.landing, p_code: referralCode() });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create the link.") };
    refresh();
    return { ok: true, message: "Link created." };
  });
}

export async function toggleLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "distributor", roles: ROLES.orgAdmin });
    const id = z.string().uuid().parse(formData.get("id"));
    const disable = formData.get("op") === "disable";
    const { error } = await ctx.supabase.rpc("set_referral_link_disabled", { p_link_id: id, p_disabled: disable });
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: disable ? "Link disabled." : "Link enabled." };
  });
}
