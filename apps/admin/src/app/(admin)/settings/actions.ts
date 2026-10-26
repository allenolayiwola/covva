"use server";
import { z } from "zod";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { KNOWN_SETTINGS, READ_ONLY_PREFIXES } from "@/lib/settings-schema";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const Save = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_:.-]{1,80}$/, "Keys are lowercase (letters, numbers, _ : . -)"),
  value: z.string().min(1, "Enter a JSON value"),
  description: z.string().trim().max(500).optional(),
});

/** Save a platform setting (JSON). Known keys are validated against their schema. */
export async function saveSetting(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Save.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { key, value, description } = parsed.data;
  if (READ_ONLY_PREFIXES.some((p) => key.startsWith(p))) return fail("This key is written by background jobs and is read-only here.");

  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch (e) {
    return fail(`Not valid JSON: ${e instanceof Error ? e.message : ""}. Strings need double quotes, e.g. "2026-10-v1".`);
  }
  const known = KNOWN_SETTINGS[key];
  if (known) {
    const r = known.schema.safeParse(json);
    if (!r.success) return fail(`${key}: ${r.error.issues.map((i) => `${i.path.join(".") || "value"} — ${i.message}`).join("; ")}`);
  }
  const { error } = await auth.supabase.from("platform_settings").upsert(
    { key, value: json as Json, description: description || null, updated_by: auth.staff.userId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["settings"]);
  return done(`${key} saved. ${webCacheNote(web)}`);
}
