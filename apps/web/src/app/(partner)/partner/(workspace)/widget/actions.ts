"use server";
import { refresh } from "next/cache";
import { contrastOk, normaliseWidgetDomain, referralCode } from "@im/core";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/** Distributor owners/admins: allowed embedding domains, brand colour (WCAG AA) and logo. */
export async function saveWidgetSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "distributor", roles: ROLES.orgAdmin });
    const rawDomains = String(formData.get("domains") ?? "").split(/[\s,]+/).filter(Boolean);
    const domains: string[] = [];
    for (const d of rawDomains) {
      const n = normaliseWidgetDomain(d);
      if (!n) return { ok: false, error: `“${d}” is not a valid https origin (e.g. https://shop.example.com).` };
      if (!domains.includes(n)) domains.push(n);
    }
    if (domains.length > 20) return { ok: false, error: "At most 20 domains." };
    const colour = String(formData.get("colour") ?? "").trim();
    if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) return { ok: false, error: "Use a hex colour like #0B6E4F." };
    if (colour && !contrastOk(colour)) return { ok: false, error: "That colour is too light for white text (WCAG AA needs 4.5:1). Choose a darker shade." };
    const logo = String(formData.get("logo") ?? "").trim();
    if (logo && !/^https:\/\//.test(logo)) return { ok: false, error: "The logo must be an https:// URL." };
    const { error } = await ctx.supabase.rpc("update_partner_widget", { p_org_id: ctx.orgId, p_widget_domains: domains, p_primary_colour: colour || undefined, p_logo_url: logo || undefined });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't save the widget settings.") };
    refresh();
    return { ok: true, message: "Widget settings saved. Changes reach live embeds within five minutes." };
  });
}

/** Create the first (widget) link when a partner has none yet. */
export async function createWidgetCode(): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "distributor", roles: ROLES.orgAdmin });
    const { error } = await ctx.supabase.rpc("create_partner_referral_link", { p_org_id: ctx.orgId, p_campaign: "widget", p_landing_path: "/", p_code: referralCode() });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create your widget code.") };
    refresh();
    return { ok: true, message: "Widget code created." };
  });
}
