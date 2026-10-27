/**
 * Voice notes (Addendum 6 §2) — limits and pure helpers shared by the browser recorder, the
 * API and the server. Recordings are ≤ 120 s; transcripts are automatic and must be checked by
 * the customer before they use them (accuracy for Twi, Ga and Ewe is limited).
 */
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_PURPOSES = ["quote_help", "claim_description", "support"] as const;
export type VoiceNotePurpose = (typeof VOICE_PURPOSES)[number];

/** Audio types the documents bucket accepts (no codec parameters). */
export const VOICE_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/aac", "audio/x-m4a"] as const;
export type VoiceMimeType = (typeof VOICE_MIME_TYPES)[number];

/**
 * `audio/webm;codecs=opus` → `audio/webm`; `video/webm` (some recorders) → `audio/webm`;
 * `audio/mp3` → `audio/mpeg`; `audio/m4a` → `audio/mp4`. Null when unsupported.
 */
export function normaliseAudioMime(input: string | null | undefined): VoiceMimeType | null {
  const base = (input ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const aliases: Record<string, VoiceMimeType> = {
    "video/webm": "audio/webm",
    "audio/mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-mp4": "audio/mp4",
    "audio/vnd.wave": "audio/wav",
    "audio/wave": "audio/wav",
    "video/mp4": "audio/mp4",
  };
  if ((VOICE_MIME_TYPES as readonly string[]).includes(base)) return base as VoiceMimeType;
  return aliases[base] ?? null;
}

export function audioExtension(mime: VoiceMimeType): string {
  switch (mime) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    default:
      return "wav";
  }
}

/** Language hints the recorder offers; transcription is only reliable for English. */
export const VOICE_LANGUAGE_HINTS = ["en", "tw", "gaa", "ee"] as const;

/** Whether to show the "local languages are less accurate" warning. */
export function voiceAccuracyWarning(languageHint: string | null | undefined, detected?: string | null): boolean {
  const l = (detected || languageHint || "en").toLowerCase();
  return !l.startsWith("en");
}

/** Append a transcript to existing free text with a blank line, never duplicating it. */
export function appendTranscript(current: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return current;
  const c = current.trimEnd();
  if (c.includes(t)) return current;
  return c ? `${c}\n\n${t}` : t;
}
