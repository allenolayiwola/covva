"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../../_lib/context";

const uuid = z.string().uuid();

/** Owners/admins add a policy-number block for delegated issuance (RLS: own organisation only). */
export async function createNumberBlock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const parsed = z
      .object({
        categoryId: z.string().uuid().or(z.literal("")).optional(),
        prefix: z.string().trim().max(40).optional(),
        firstNumber: z.coerce.number().int().min(0),
        lastNumber: z.coerce.number().int().min(0),
        pad: z.coerce.number().int().min(0).max(12).default(6),
      })
      .safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
    const input = parsed.data;
    if (input.lastNumber < input.firstNumber) return { ok: false, error: "The last number must be at least the first number." };
    const { error } = await ctx.supabase.from("policy_number_blocks").insert({
      insurer_org_id: ctx.orgId,
      category_id: input.categoryId || null,
      prefix: input.prefix ?? "",
      next_number: input.firstNumber,
      last_number: input.lastNumber,
      pad: input.pad,
      active: true,
      created_by: ctx.userId,
    });
    if (error?.code === "23505") return { ok: false, error: "There is already an active block for this line. Deactivate it first." };
    if (error) return { ok: false, error: dbMessage(error, "We couldn't add the block.") };
    refresh();
    return { ok: true, message: `Block added: ${input.lastNumber - input.firstNumber + 1} numbers available for delegated issuance.` };
  });
}

export async function deactivateNumberBlock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.orgAdmin });
    const blockId = uuid.parse(formData.get("blockId"));
    const { data, error } = await ctx.supabase.from("policy_number_blocks").update({ active: false }).eq("id", blockId).eq("insurer_org_id", ctx.orgId).select("id");
    if (error) return { ok: false, error: dbMessage(error) };
    if (!data?.length) return { ok: false, error: "Block not found." };
    refresh();
    return { ok: true, message: "Block deactivated." };
  });
}
