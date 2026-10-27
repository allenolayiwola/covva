import { z } from "zod";
import { VOICE_MAX_BYTES, VOICE_PURPOSES } from "@im/core";
import { invalid, withApi } from "@/server/api-auth";
import { saveVoiceNote, voiceNoteView } from "@/server/voice";
import { BusinessRuleError } from "@/server/requests";

export const maxDuration = 30;

const Meta = z.object({
  purpose: z.enum(VOICE_PURPOSES),
  durationSeconds: z.coerce.number().min(0).max(130).optional(),
  languageHint: z.string().trim().max(10).optional(),
  requestId: z.string().uuid().optional(),
  claimId: z.string().uuid().optional(),
});
const JsonBody = Meta.extend({ audioBase64: z.string().min(16).max(Math.ceil((VOICE_MAX_BYTES * 4) / 3) + 64), mimeType: z.string().min(3).max(100) });

/**
 * POST /api/v1/voice-notes — upload a voice note (≤ 120 s, ≤ 10 MB).
 *   multipart/form-data: `file` + `purpose`, `durationSeconds?`, `languageHint?`, `requestId?`, `claimId?`
 *   application/json:    `{ audioBase64, mimeType, purpose, … }` (mobile)
 * Returns the note with `transcriptStatus: "pending"`; poll GET /api/v1/voice-notes/{id}.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const type = req.headers.get("content-type") ?? "";
    let bytes: Uint8Array;
    let mimeType: string;
    let meta: z.infer<typeof Meta>;
    if (type.includes("multipart/form-data")) {
      const fd = await req.formData().catch(() => null);
      if (!fd) throw invalid("Send the recording as multipart/form-data with a `file` field.");
      const file = fd.get("file");
      if (!(file instanceof Blob)) throw invalid("Attach the recording as `file`.");
      if (file.size > VOICE_MAX_BYTES) throw invalid("Voice notes can be up to 10 MB.");
      const parsed = Meta.safeParse(Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== "file" && typeof v === "string" && v !== "")));
      if (!parsed.success) throw invalid("Some details are missing or invalid.", parsed.error.issues);
      meta = parsed.data;
      bytes = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type || "audio/webm";
    } else {
      const parsed = JsonBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) throw invalid("Some details are missing or invalid.", parsed.error.issues);
      meta = parsed.data;
      bytes = new Uint8Array(Buffer.from(parsed.data.audioBase64.replace(/^data:[^,]*,/, ""), "base64"));
      mimeType = parsed.data.mimeType;
    }
    try {
      const note = await saveVoiceNote(auth.supabase, { ownerId: auth.userId, purpose: meta.purpose, bytes, mimeType, durationSeconds: meta.durationSeconds, languageHint: meta.languageHint, requestId: meta.requestId, claimId: meta.claimId });
      return Response.json({ ok: true, data: { voiceNote: voiceNoteView(note) } }, { status: 201 });
    } catch (err) {
      if (err instanceof BusinessRuleError) throw invalid(err.message);
      throw err;
    }
  },
  { auth: "user" },
);
