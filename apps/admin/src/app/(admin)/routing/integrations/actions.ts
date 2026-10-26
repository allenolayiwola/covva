"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean)));

const Line = z.object({
  insurerOrgId: z.string().uuid({ error: "Choose an insurer" }),
  categoryId: z.string().uuid({ error: "Choose a category" }),
  level: z.enum(["L1", "L2", "L3"]),
  direct_sales: z.string().optional(),
  sla_hours: z.coerce.number().int().min(1).max(720),
  issuance_type: z.enum(["instant", "within_hours", "manual"]),
  nominated: list,
  active: z.string().optional(),
});

/** Create or replace an insurer's integration for one product line (one row per insurer × category). */
export async function saveLineIntegration(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Line.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const { data: insurer } = await auth.supabase.from("organizations").select("type").eq("id", d.insurerOrgId).single();
  if (insurer?.type !== "insurer") return fail("Line integrations belong to insurer organisations.");
  const nominated = d.nominated.filter((id) => z.string().uuid().safeParse(id).success);
  const { error } = await auth.supabase.from("insurer_line_integrations").upsert(
    {
      insurer_org_id: d.insurerOrgId,
      category_id: d.categoryId,
      level: d.level,
      direct_sales: d.direct_sales === "on",
      sla_hours: d.sla_hours,
      issuance_type: d.issuance_type,
      nominated_broker_org_ids: nominated,
      active: d.active === "on",
    },
    { onConflict: "insurer_org_id,category_id" },
  );
  if (error) return fail(dbMessage(error));
  return done("Line integration saved. New requests on this line use it immediately.");
}

const Toggle = z.object({ integrationId: z.string().uuid(), value: z.enum(["true", "false"]) });

export async function toggleLineIntegration(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("insurer_line_integrations").update({ active: parsed.data.value === "true" }).eq("id", parsed.data.integrationId);
  if (error) return fail(dbMessage(error));
  return done(parsed.data.value === "true" ? "Integration activated." : "Integration paused — orders on this line go through brokers.");
}
