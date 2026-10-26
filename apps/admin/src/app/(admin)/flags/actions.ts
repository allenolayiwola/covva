"use server";
import { z } from "zod";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const Toggle = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/), value: z.enum(["true", "false"]), description: z.string().max(500).optional() });

/** Toggle a feature flag (creates it if missing). Refreshes flag caches here and on the public site. */
export async function toggleFlag(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { key, value, description } = parsed.data;
  const { error } = await auth.supabase.from("feature_flags").upsert(
    { key, enabled: value === "true", updated_by: auth.staff.userId, updated_at: new Date().toISOString(), ...(description ? { description } : {}) },
    { onConflict: "key" },
  );
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["flags"]);
  return done(`${key} ${value === "true" ? "enabled" : "disabled"}. ${webCacheNote(web)}`);
}

const Save = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/, "Keys are snake_case"),
  description: z.string().trim().max(500).optional(),
  rules: z.string().trim().optional(),
  enabled: z.string().optional(),
});

export async function saveFlag(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Save.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  let rules: Record<string, unknown> = {};
  if (parsed.data.rules) {
    try {
      const r = JSON.parse(parsed.data.rules);
      if (typeof r !== "object" || Array.isArray(r) || r === null) throw new Error();
      rules = r;
    } catch {
      return fail("Rules must be a JSON object, e.g. {\"roles\":[\"broker\"]}.");
    }
  }
  const { error } = await auth.supabase.from("feature_flags").upsert(
    { key: parsed.data.key, description: parsed.data.description || null, rules: rules as Json, enabled: parsed.data.enabled === "on", updated_by: auth.staff.userId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["flags"]);
  return done(`Flag saved. ${webCacheNote(web)}`);
}
