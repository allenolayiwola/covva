"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const money = z.coerce.number().min(0, "Must be zero or more").max(10_000_000);
const optInt = z.string().optional().transform((v) => (v && v.trim() !== "" ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Whole number");

const Plan = z.object({
  planId: z.union([z.string().uuid(), z.literal("")]).optional(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "Code: lowercase letters, numbers and underscores"),
  name: z.string().trim().min(2).max(120),
  audience: z.enum(["broker", "insurer", "enterprise"]),
  description: z.string().trim().max(1000).optional(),
  monthly_fee: money,
  included_seats: optInt,
  included_requests: optInt,
  per_request_fee: money,
  per_active_policy_fee: money,
  features: z.string().optional(),
  sort_order: z.coerce.number().int().min(0).max(10000).default(100),
  active: z.string().optional(),
});

/** Create or update a SaaS plan. Plans are never deleted — deactivate instead. */
export async function savePlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Plan.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { planId, features, active, description, ...rest } = parsed.data;
  const values = {
    ...rest,
    description: description || null,
    features: (features ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    active: active === "on",
  };
  const { error } = planId
    ? await auth.supabase.from("plans").update(values).eq("id", planId)
    : await auth.supabase.from("plans").insert(values);
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["plans"]);
  return done(`Plan ${planId ? "updated" : "created"}. ${webCacheNote(web)}`);
}
