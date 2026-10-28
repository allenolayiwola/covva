"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const Input = z.object({
  integrationId: z.string().uuid(),
  direct_sales: z.string().optional(),
  nominated: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Insurer owners/admins may switch direct sales on/off and nominate brokers for a line
 * they are integrated on. The level, SLA and issuance type are set by the platform
 * (line_integrations_guard trigger rejects anything else).
 */
export async function updateLineIntegration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const raw = { integrationId: formData.get("integrationId"), direct_sales: formData.get("direct_sales") ?? undefined, nominated: formData.getAll("nominated").map(String) };
    const input = Input.parse(raw);
    const nominated = (Array.isArray(input.nominated) ? input.nominated : input.nominated ? [input.nominated] : []).filter((id) => z.string().uuid().safeParse(id).success);

    const { data: row } = await ctx.supabase.from("insurer_line_integrations").select("id, insurer_org_id, level").eq("id", input.integrationId).maybeSingle();
    if (!row || row.insurer_org_id !== ctx.orgId) return { ok: false, error: "Integration not found." };

    // Nominees must be brokers this insurer has appointed.
    if (nominated.length) {
      const { data: appts } = await ctx.supabase.from("insurer_broker_appointments").select("broker_org_id").eq("insurer_org_id", ctx.orgId).eq("active", true);
      const appointed = new Set((appts ?? []).map((a) => a.broker_org_id));
      if (nominated.some((id) => !appointed.has(id))) return { ok: false, error: "You can only nominate brokers you have appointed." };
    }

    const { error } = await ctx.supabase
      .from("insurer_line_integrations")
      .update({ direct_sales: input.direct_sales === "on", nominated_broker_org_ids: nominated })
      .eq("id", row.id);
    if (error) return { ok: false, error: dbMessage(error, "We couldn't save the integration settings.") };
    refresh();
    return { ok: true, message: "Routing preferences saved. New orders use them immediately." };
  });
}
