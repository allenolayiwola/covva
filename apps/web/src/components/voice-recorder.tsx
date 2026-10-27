"use client";

import * as React from "react";
import { Loader2, Mic, Square, Trash2, Upload } from "lucide-react";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, appendTranscript, normaliseAudioMime, type MessageKey, type VoiceNotePurpose } from "@im/core";
import { Button, Notice, Select, Textarea, cn } from "@im/ui";
import { useT } from "@/lib/i18n/client";

type Phase = "idle" | "recording" | "uploading" | "transcribing" | "done" | "failed" | "error";

interface NoteView {
  id: string;
  transcriptStatus: "pending" | "done" | "failed";
  transcript: string | null;
  failureReason: string | null;
  lowerAccuracy: boolean;
}

const PREFERRED = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return PREFERRED.find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Voice note recorder (≤ 120 s) with an editable automatic transcript.
 *
 * Records with MediaRecorder (or accepts an audio file), uploads to `POST /api/v1/voice-notes`,
 * polls for the transcript and shows it labelled "Automatic transcript — please check". The
 * customer edits it and presses "Add to my description" — the text is appended to the form field
 * through `onUseTranscript`. Nothing is submitted automatically. `onSaved` gives the note id so
 * the form can link it to the request / claim it creates.
 */
export function VoiceRecorder({
  purpose,
  titleKey,
  onUseTranscript,
  onSaved,
  requestId,
  claimId,
  className,
}: {
  purpose: VoiceNotePurpose;
  titleKey: MessageKey;
  onUseTranscript: (text: string) => void;
  onSaved?: (id: string) => void;
  requestId?: string;
  claimId?: string;
  className?: string;
}) {
  const t = useT();
  const uid = React.useId();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [message, setMessage] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<NoteView | null>(null);
  const [text, setText] = React.useState("");
  const [added, setAdded] = React.useState(false);
  const [lang, setLang] = React.useState("en");
  const [supported, setSupported] = React.useState(true);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const timer = React.useRef<number | undefined>(undefined);
  const startedAt = React.useRef(0);
  const stream = React.useRef<MediaStream | null>(null);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after hydration (browser-only APIs)
    setSupported(typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
    return () => {
      alive.current = false;
      window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  async function poll(id: string) {
    for (let i = 0; i < 40 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 3000));
      const res = await fetch(`/api/v1/voice-notes/${id}`, { headers: { accept: "application/json" } }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { ok?: boolean; data?: { voiceNote?: NoteView } } | null;
      const v = json?.ok ? json.data?.voiceNote : null;
      if (!v) continue;
      if (v.transcriptStatus !== "pending") {
        if (!alive.current) return;
        setNote(v);
        if (v.transcriptStatus === "done" && v.transcript) {
          setText(v.transcript);
          setPhase("done");
        } else {
          setPhase("failed");
          setMessage(v.failureReason === "transcription_disabled" ? t("voice.unavailable") : t("voice.failed"));
        }
        return;
      }
    }
    if (alive.current) {
      setPhase("failed");
      setMessage(t("voice.failed"));
    }
  }

  async function upload(blob: Blob, durationSeconds: number | null) {
    const mime = normaliseAudioMime(blob.type) ?? "audio/webm";
    if (blob.size > VOICE_MAX_BYTES) {
      setPhase("error");
      setMessage(t("voice.tooLarge"));
      return;
    }
    setPhase("uploading");
    setMessage(null);
    const fd = new FormData();
    fd.append("file", new File([blob], `voice-note.${mime.split("/")[1] ?? "webm"}`, { type: mime }));
    fd.append("purpose", purpose);
    fd.append("languageHint", lang);
    if (durationSeconds != null) fd.append("durationSeconds", String(Math.round(durationSeconds)));
    if (requestId) fd.append("requestId", requestId);
    if (claimId) fd.append("claimId", claimId);
    try {
      const res = await fetch("/api/v1/voice-notes", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: { voiceNote?: NoteView }; error?: { message?: string } } | null;
      const v = json?.ok ? json.data?.voiceNote : null;
      if (!v) throw new Error(json?.error?.message ?? "upload failed");
      setNote(v);
      onSaved?.(v.id);
      setPhase("transcribing");
      void poll(v.id);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error && err.message !== "upload failed" ? err.message : t("voice.error"));
    }
  }

  async function start() {
    setMessage(null);
    setAdded(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mimeType = pickMime();
      const rec = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        window.clearInterval(timer.current);
        s.getTracks().forEach((tr) => tr.stop());
        const duration = (Date.now() - startedAt.current) / 1000;
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
        if (alive.current && blob.size) void upload(blob, Math.min(duration, VOICE_MAX_SECONDS));
        else if (alive.current) setPhase("idle");
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      setSeconds(0);
      rec.start(1000);
      setPhase("recording");
      timer.current = window.setInterval(() => {
        const s2 = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s2);
        if (s2 >= VOICE_MAX_SECONDS) stop();
      }, 250);
    } catch {
      setPhase("error");
      setMessage(t("voice.permission"));
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  function discard() {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    setPhase("idle");
    setNote(null);
    setText("");
    setMessage(null);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!normaliseAudioMime(f.type)) {
      setPhase("error");
      setMessage(t("voice.unsupported"));
      return;
    }
    setAdded(false);
    void upload(f, null);
  }

  async function useTranscript() {
    const v = text.trim();
    if (!v) return;
    onUseTranscript(v);
    setAdded(true);
    if (note && v !== (note.transcript ?? "")) {
      fetch(`/api/v1/voice-notes/${note.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript: v }) }).catch(() => {});
    }
  }

  const busy = phase === "uploading" || phase === "transcribing";

  return (
    <section aria-labelledby={`${uid}-title`} className={cn("rounded-card border border-line bg-mist/50 p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${uid}-title`} className="flex items-center gap-2 font-semibold text-ink">
            <Mic aria-hidden className="size-4 text-brand" /> {t(titleKey)}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{t("voice.hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${uid}-lang`} className="text-xs text-muted">{t("voice.languageLabel")}</label>
          <Select id={`${uid}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={phase === "recording" || busy} className="h-9 w-auto min-w-[110px] text-sm">
            <option value="en">English</option>
            <option value="tw">Twi</option>
            <option value="gaa">Gã</option>
            <option value="ee">Eʋegbe</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {phase === "recording" ? (
          <>
            <Button type="button" variant="primary" size="sm" onClick={stop}>
              <Square aria-hidden className="size-4" /> {t("voice.stop")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={discard}>
              <Trash2 aria-hidden className="size-4" /> {t("voice.discard")}
            </Button>
          </>
        ) : (
          supported && (
            <Button type="button" variant="secondary" size="sm" onClick={start} disabled={busy}>
              <Mic aria-hidden className="size-4" /> {t("voice.record")}
            </Button>
          )
        )}
        <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand hover:underline has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", (busy || phase === "recording") && "pointer-events-none opacity-60")}>
          <Upload aria-hidden className="size-4" />
          {t("voice.fileLabel")}
          <input type="file" accept="audio/*" className="sr-only" onChange={onFile} disabled={busy || phase === "recording"} />
        </label>
      </div>

      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-2">
        {phase === "recording" && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" />
            {t("voice.recording", { seconds, max: VOICE_MAX_SECONDS })}
          </span>
        )}
        {phase === "uploading" && (
          <span className="inline-flex items-center gap-2"><Loader2 aria-hidden className="size-4 animate-spin" /> {t("voice.uploading")}</span>
        )}
        {phase === "transcribing" && (
          <span className="inline-flex items-center gap-2"><Loader2 aria-hidden className="size-4 animate-spin" /> {t("voice.saved")} {t("voice.transcribing")}</span>
        )}
        {!supported && phase === "idle" && t("voice.unsupported")}
      </p>

      {(phase === "failed" || phase === "error") && message && (
        <Notice tone={phase === "failed" ? "wait" : "danger"} className="mt-2">{message}</Notice>
      )}

      {phase === "done" && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${uid}-tx`} className="block text-sm font-medium text-ink-2">{t("voice.transcriptLabel")}</label>
          <Textarea id={`${uid}-tx`} value={text} onChange={(e) => { setText(e.target.value); setAdded(false); }} maxLength={10000} className="min-h-24" aria-describedby={`${uid}-txh`} />
          <p id={`${uid}-txh`} className="text-xs text-subtle">
            {t("voice.transcriptHint")} {note?.lowerAccuracy || lang !== "en" ? t("voice.localAccuracy") : null}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={useTranscript} disabled={!text.trim()}>{t("voice.useTranscript")}</Button>
            {added && <span className="text-sm text-brand">{t("voice.added")}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
