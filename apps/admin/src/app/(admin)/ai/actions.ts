"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { KNOWN_SETTINGS } from "@/lib/settings-schema";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const Models = z.object({ default: z.string().trim(), fast: z.string().trim() });

/** Save AI Gateway model ids into platform_settings.ai_models. */
export async function saveAiModels(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Models.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const check = KNOWN_SETTINGS.ai_models!.schema.safeParse(parsed.data);
  if (!check.success) return fail(check.error.issues[0]?.message ?? "Invalid model id");
  const { error } = await auth.supabase.from("platform_settings").upsert(
    { key: "ai_models", value: parsed.data, description: "AI Gateway model ids (default / fast)", updated_by: auth.staff.userId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["settings"]);
  return done(`Model settings saved. ${webCacheNote(web)}`);
}
