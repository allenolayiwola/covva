import { z } from "zod";
import { dbError, notFound, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { fromTable, type VoiceNoteRow } from "@/server/phase3-tables";
import { voiceNoteView } from "@/server/voice";

type Ctx = RouteContext<"/api/v1/voice-notes/[id]">;

/** GET /api/v1/voice-notes/{id} — status, transcript ("Automatic transcript — please check") and a 10-minute audio link. */
export const GET = withApi<"user", Ctx>(
  async ({ auth }, ctx) => {
    const id = uuidParam((await ctx.params).id);
    const { data, error } = await fromTable(auth.supabase, "voice_notes").select("*").eq("id", id).maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw notFound("Voice note not found.");
    const note = data as VoiceNoteRow;
    const { data: signed } = await auth.supabase.storage.from("documents").createSignedUrl(note.storage_path, 600);
    return { voiceNote: voiceNoteView(note, signed?.signedUrl ?? null) };
  },
  { auth: "user" },
);

const Patch = z.object({ transcript: z.string().max(10000) });

/** PATCH /api/v1/voice-notes/{id} — the owner corrects the transcript. */
export const PATCH = withApi<"user", Ctx>(
  async ({ auth, req }, ctx) => {
    const id = uuidParam((await ctx.params).id);
    const body = await parseJson(req, Patch);
    const { data, error } = await fromTable(auth.supabase, "voice_notes").update({ transcript: body.transcript.trim() || null }).eq("id", id).eq("owner_id", auth.userId).select("*").maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw notFound("Voice note not found.");
    return { voiceNote: voiceNoteView(data as VoiceNoteRow) };
  },
  { auth: "user" },
);
