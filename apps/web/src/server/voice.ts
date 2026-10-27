import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { transcribe } from "ai";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, audioExtension, normaliseAudioMime, normaliseLocale, voiceAccuracyWarning, type VoiceNotePurpose } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/server/ai/config";
import { logAiUsage } from "@/server/ai/usage";
import { BusinessRuleError } from "@/server/requests";
import { log } from "@/server/log";
import { fromTable, type VoiceNoteRow } from "@/server/phase3-tables";
import type { UserClient } from "@/server/api-auth";

/**
 * Voice notes (Addendum 6 §2): quote help, claim descriptions and support.
 *
 * Audio (≤ 120 s, ≤ 10 MB) goes to the private `documents` bucket under `voice/<owner>/…` as the
 * customer (RLS). The transcript is produced AFTER the response (`after()`), stored on the row and
 * shown to the owner labelled "Automatic transcript — please check" for them to edit and copy into
 * their claim or request. Nothing is ever submitted automatically.
 *
 * Transcription provider (`TRANSCRIPTION_PROVIDER`):
 *   - `gateway` (default when the AI Gateway is configured): AI SDK `transcribe()` with a plain
 *     gateway model id, `TRANSCRIPTION_MODEL` (default `openai/gpt-4o-mini-transcribe`);
 *   - `openai`: OpenAI's API directly with `OPENAI_API_KEY` (`whisper-1` / `gpt-4o-mini-transcribe`);
 *   - `none`: no transcription (status `failed`, reason `transcription_disabled`).
 * Twi, Ga and Ewe accuracy is limited with every provider today.
 */
export type TranscriptionProvider = "gateway" | "openai" | "none";

export function transcriptionProvider(): TranscriptionProvider {
  const v = (process.env.TRANSCRIPTION_PROVIDER ?? "").trim().toLowerCase();
  if (v === "gateway" || v === "openai" || v === "none") return v;
  if (aiConfigured()) return "gateway";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

export function transcriptionModel(provider = transcriptionProvider()): string {
  const m = process.env.TRANSCRIPTION_MODEL?.trim();
  if (provider === "openai") return m && !m.includes("/") ? m : "gpt-4o-mini-transcribe";
  return m && m.includes("/") ? m : "openai/gpt-4o-mini-transcribe";
}

export interface SaveVoiceNoteInput {
  ownerId: string;
  purpose: VoiceNotePurpose;
  bytes: Uint8Array;
  mimeType: string;
  durationSeconds?: number | null;
  languageHint?: string | null;
  requestId?: string | null;
  claimId?: string | null;
  /** Schedule transcription with `after()` (default true). */
  transcribe?: boolean;
}

/** Validate, upload as the user, create the row (RLS: owner insert) and queue the transcript. */
export async function saveVoiceNote(db: UserClient, input: SaveVoiceNoteInput): Promise<VoiceNoteRow> {
  const mime = normaliseAudioMime(input.mimeType);
  if (!mime) throw new BusinessRuleError("That audio format isn't supported. Record again or choose an MP3, M4A, OGG, WAV or WebM file.", "invalid_input");
  if (!input.bytes.byteLength) throw new BusinessRuleError("The recording is empty.", "invalid_input");
  if (input.bytes.byteLength > VOICE_MAX_BYTES) throw new BusinessRuleError("Voice notes can be up to 10 MB.", "invalid_input");
  const duration = input.durationSeconds == null || !Number.isFinite(input.durationSeconds) ? null : Math.max(0, Math.round(input.durationSeconds));
  if (duration != null && duration > VOICE_MAX_SECONDS + 3) throw new BusinessRuleError("Voice notes can be up to 2 minutes long.", "invalid_input");
  const hint = input.languageHint ? (normaliseLocale(input.languageHint) ?? null) : null;

  const path = `voice/${input.ownerId}/${randomUUID()}.${audioExtension(mime)}`;
  const { error: upErr } = await db.storage.from("documents").upload(path, input.bytes, { contentType: mime, upsert: false });
  if (upErr) {
    log.warn("voice.upload_failed", { err: upErr });
    throw new BusinessRuleError("We couldn't save the recording. Please try again.");
  }
  const { data, error } = await fromTable(db, "voice_notes")
    .insert({
      owner_id: input.ownerId,
      purpose: input.purpose,
      request_id: input.requestId ?? null,
      claim_id: input.claimId ?? null,
      storage_path: path,
      mime_type: mime,
      size_bytes: input.bytes.byteLength,
      duration_seconds: duration == null ? null : Math.min(duration, VOICE_MAX_SECONDS + 3),
      language_hint: hint,
    })
    .select("*")
    .single();
  if (error || !data) {
    log.warn("voice.insert_failed", { err: error });
    throw new BusinessRuleError(error?.code === "P0001" && error.message ? error.message : "We couldn't save the recording. Please try again.");
  }
  const row = data as VoiceNoteRow;
  if (input.transcribe !== false) {
    after(async () => {
      await transcribeVoiceNote(row.id);
    });
  }
  return row;
}

/**
 * Transcribe one note (service role) and store the result. Idempotent: notes already done are
 * left alone. Never throws.
 */
export async function transcribeVoiceNote(id: string): Promise<Pick<VoiceNoteRow, "id" | "transcript_status" | "transcript" | "transcript_language" | "failure_reason">> {
  const svc = createServiceClient();
  const { data } = await fromTable(svc, "voice_notes").select("*").eq("id", id).maybeSingle();
  const note = data as VoiceNoteRow | null;
  if (!note) return { id, transcript_status: "failed", transcript: null, transcript_language: null, failure_reason: "not_found" };
  if (note.transcript_status === "done") return note;
  const provider = transcriptionProvider();
  const fail = async (reason: string, model: string | null = null) => {
    await fromTable(svc, "voice_notes").update({ transcript_status: "failed", failure_reason: reason, model }).eq("id", id);
    return { id, transcript_status: "failed" as const, transcript: null, transcript_language: null, failure_reason: reason };
  };
  if (provider === "none") return fail("transcription_disabled");

  const { data: file, error: dlErr } = await svc.storage.from("documents").download(note.storage_path);
  if (dlErr || !file) return fail("audio_missing");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const model = transcriptionModel(provider);
  const started = Date.now();
  try {
    const result = provider === "openai" ? await openAiTranscribe(bytes, note.mime_type ?? "audio/webm", model, note.language_hint) : await gatewayTranscribe(bytes, model, note.language_hint);
    const text = result.text.trim().slice(0, 10000);
    if (!text) return fail("empty_transcript", model);
    await fromTable(svc, "voice_notes")
      .update({ transcript: text, transcript_language: result.language ?? note.language_hint ?? null, transcript_status: "done", failure_reason: null, model })
      .eq("id", id);
    await logAiUsage({ feature: "voice_transcription", model, latencyMs: Date.now() - started, success: true, userId: note.owner_id });
    return { id, transcript_status: "done", transcript: text, transcript_language: result.language ?? null, failure_reason: null };
  } catch (err) {
    log.warn("voice.transcription_failed", { id, provider, model, err });
    await logAiUsage({ feature: "voice_transcription", model, latencyMs: Date.now() - started, success: false, userId: note.owner_id });
    return fail("provider_error", model);
  }
}

async function gatewayTranscribe(bytes: Uint8Array, model: string, hint: string | null): Promise<{ text: string; language?: string | null }> {
  // Only English is a language the providers reliably support; for Twi/Ga/Ewe let them detect.
  const providerOptions = hint === "en" ? { openai: { language: "en" } } : undefined;
  const r = await transcribe({ model, audio: bytes, providerOptions, maxRetries: 1, abortSignal: AbortSignal.timeout(60_000) });
  return { text: r.text, language: r.language ?? null };
}

async function openAiTranscribe(bytes: Uint8Array, mime: string, model: string, hint: string | null): Promise<{ text: string; language?: string | null }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const form = new FormData();
  const ext = audioExtension(normaliseAudioMime(mime) ?? "audio/webm");
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), `voice.${ext}`);
  form.append("model", model);
  form.append("response_format", model === "whisper-1" ? "verbose_json" : "json");
  if (hint === "en") form.append("language", "en");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}`);
  const json = (await res.json()) as { text?: string; language?: string };
  return { text: json.text ?? "", language: json.language ?? null };
}

/** The shape returned by the API and used by the recorder. */
export function voiceNoteView(n: VoiceNoteRow, audioUrl?: string | null) {
  return {
    id: n.id,
    purpose: n.purpose,
    requestId: n.request_id,
    claimId: n.claim_id,
    durationSeconds: n.duration_seconds,
    languageHint: n.language_hint,
    transcriptStatus: n.transcript_status,
    transcript: n.transcript,
    transcriptLanguage: n.transcript_language,
    transcriptLabel: "Automatic transcript — please check",
    lowerAccuracy: voiceAccuracyWarning(n.language_hint, n.transcript_language),
    failureReason: n.failure_reason,
    editedAt: n.transcript_edited_at,
    createdAt: n.created_at,
    audioUrl: audioUrl ?? null,
  };
}

/**
 * Attach the owner's voice notes to the request / claim they just created (RLS + guard: own
 * notes, own request/claim). Best effort — a failure never blocks the submission.
 */
export async function linkVoiceNotes(db: UserClient, ids: string[], target: { requestId?: string | null; claimId?: string | null }): Promise<number> {
  const clean = [...new Set(ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)))].slice(0, 5);
  if (!clean.length || (!target.requestId && !target.claimId)) return 0;
  const patch: Record<string, string> = {};
  if (target.requestId) patch.request_id = target.requestId;
  if (target.claimId) patch.claim_id = target.claimId;
  const { data, error } = await fromTable(db, "voice_notes").update(patch).in("id", clean).select("id");
  if (error) {
    log.warn("voice.link_failed", { err: error });
    return 0;
  }
  return (data ?? []).length;
}
