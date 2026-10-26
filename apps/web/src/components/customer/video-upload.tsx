"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Video, X } from "lucide-react";
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, validateClaimVideo } from "@im/core";
import { documentPath, STORAGE_BUCKETS } from "@im/db";
import { Button, Notice, cn } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, type ActionState, type UploadedFile } from "./utils";

export type UploadedVideo = UploadedFile & { durationSeconds: number | null };

/** Read the clip length from the browser's decoder before uploading (null when the browser can't decode it). */
function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

/** Upload a short claim video straight from the browser to the customer's claims folder (RLS-enforced). */
export async function uploadClaimVideoToStorage(userId: string, file: File): Promise<UploadedVideo> {
  const mime = (file.type || "video/mp4").split(";")[0]!;
  const durationSeconds = await measureDuration(file);
  const check = validateClaimVideo({ mimeType: mime, sizeBytes: file.size, durationSeconds });
  if (!check.ok) throw new Error(check.reason);
  const path = documentPath(userId, "claims", `video-${file.name || "clip.mp4"}`);
  const { error } = await createClient().storage.from(STORAGE_BUCKETS.documents).upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error(/mime|type/i.test(error.message) ? "That video format isn't supported. Use MP4, WebM or MOV." : "Upload failed. Check your connection and try again.");
  return { path, name: file.name || "video", size: file.size, mime, durationSeconds };
}

const HINT = `Up to ${MAX_VIDEO_SECONDS} seconds and ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB · MP4, WebM or MOV`;

/**
 * Claim video picker: records with the phone camera (`capture`) or picks a file, checks the length and size on
 * the device, uploads immediately and either writes the list into a hidden input (`name`, for the report form) or
 * calls `action` (claim page) to record it.
 */
export function VideoUpload({
  userId,
  name,
  action,
  label = "Short video of the damage or scene",
  hint = HINT,
  max = 2,
  className,
}: {
  userId: string;
  /** Hidden input name (JSON list) when used inside a form that is submitted later. */
  name?: string;
  /** Called after each upload when used standalone on the claim page. */
  action?: (file: UploadedVideo) => Promise<ActionState>;
  label?: string;
  hint?: string;
  max?: number;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<UploadedVideo[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const id = React.useId();

  async function handle(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const up = await uploadClaimVideoToStorage(userId, file);
      if (action) {
        const res = await action(up);
        if (!res.ok) {
          await createClient().storage.from(STORAGE_BUCKETS.documents).remove([up.path]).catch(() => {});
          setError(res.error ?? "We couldn't save the video.");
        } else {
          setMessage(res.message ?? "Video added.");
          router.refresh();
        }
      } else {
        setFiles((prev) => [...prev, up]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path));
    void createClient().storage.from(STORAGE_BUCKETS.documents).remove([path]).catch(() => {});
  }

  return (
    <div className={className}>
      <p className="mb-1.5 text-sm font-medium text-ink-2">
        <label htmlFor={id}>{label}</label>
        {files.length > 0 && <span className="font-normal text-muted"> · {files.length} added</span>}
      </p>
      {name && <input type="hidden" name={name} value={JSON.stringify(files)} />}
      <input ref={inputRef} id={id} type="file" accept="video/*" capture="environment" className="sr-only" onChange={(e) => void handle(e.target.files)} disabled={busy} />
      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.path} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
            <Video aria-hidden className="size-4 text-muted" />
            <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
            <span className="text-xs text-subtle">{[f.durationSeconds != null ? `${Math.round(f.durationSeconds)}s` : null, formatBytes(f.size)].filter(Boolean).join(" · ")}</span>
            <button type="button" onClick={() => remove(f.path)} className="text-muted hover:text-danger" aria-label={`Remove ${f.name}`}>
              <X className="size-4" />
            </button>
          </div>
        ))}
        {(action || files.length < max) && (
          <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => inputRef.current?.click()} className={cn(busy && "opacity-80")}>
            <Video aria-hidden className="size-4" /> {busy ? "Uploading…" : files.length ? "Add another video" : "Record or choose a video"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-subtle">{hint}</p>
      <div aria-live="polite">
        {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
        {message && <p className="mt-2 text-sm text-brand-dark">{message}</p>}
      </div>
    </div>
  );
}
