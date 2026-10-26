"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { documentPath, STORAGE_BUCKETS } from "@im/db";
import { Button, Notice, cn } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { ACCEPTED_UPLOADS, MAX_UPLOAD_BYTES, formatBytes, type ActionState, type UploadedFile } from "./utils";
export type { UploadedFile } from "./utils";


type Scope = "requests" | "policies" | "claims" | "profile";

/** Upload one file to the private `documents` bucket under the customer's own folder (RLS-enforced). */
export async function uploadToStorage(userId: string, scope: Scope, file: File): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
  const path = documentPath(userId, scope, file.name);
  const supabase = createClient();
  const { error } = await supabase.storage.from(STORAGE_BUCKETS.documents).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) {
    throw new Error(
      /mime|type/i.test(error.message) ? "That file type isn't supported. Use PDF, JPG or PNG." : "Upload failed. Check your connection and try again.",
    );
  }
  return { path, name: file.name, size: file.size, mime: file.type };
}

/** Best-effort removal of an uploaded object (e.g. the user removed it before submitting). */
export async function removeFromStorage(path: string) {
  await createClient().storage.from(STORAGE_BUCKETS.documents).remove([path]);
}

/**
 * Drop zone from the request-tracking mockup. Uploads directly to Storage from the browser
 * (no server hop for the bytes — kinder to slow connections), then records the document with a
 * Server Action passed in by the parent.
 */
export function UploadDropzone({
  userId,
  scope,
  title,
  hint = "PDF, JPG or PNG · up to 10 MB",
  action,
  buttonLabel = "Choose file",
  compact = false,
  className,
}: {
  userId: string;
  scope: Scope;
  title: string;
  hint?: string;
  action: (file: UploadedFile) => Promise<ActionState>;
  buttonLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [result, setResult] = React.useState<{ error?: string; message?: string } | null>(null);
  const id = React.useId();

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const uploaded = await uploadToStorage(userId, scope, file);
      const res = await action(uploaded);
      if (!res.ok) {
        await removeFromStorage(uploaded.path).catch(() => {});
        setResult({ error: res.error ?? "We couldn't save that document." });
      } else {
        setResult({ message: res.message ?? `${file.name} uploaded.` });
        router.refresh();
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center",
          drag ? "border-brand bg-mint-2" : "border-line bg-mist/40",
          compact && "p-3",
        )}
      >
        <Upload aria-hidden className="hidden size-5 shrink-0 text-brand sm:block" />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block font-medium text-ink">{title}</label>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPTED_UPLOADS}
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
          disabled={busy}
        />
        <Button type="button" size={compact ? "sm" : "md"} loading={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Uploading…" : buttonLabel}
        </Button>
      </div>
      <div aria-live="polite">
        {result?.error && <Notice tone="danger" className="mt-2">{result.error}</Notice>}
        {result?.message && <p className="mt-2 text-sm text-brand-dark">{result.message}</p>}
      </div>
    </div>
  );
}

/**
 * Collects several files for a form that is submitted later (claim evidence, external policy).
 * Files are uploaded immediately so a dropped connection doesn't lose earlier ones; the parent
 * gets the list of uploaded paths via a hidden input named `name` (JSON).
 */
export function MultiUpload({
  userId,
  scope,
  name,
  label,
  hint = "PDF, JPG or PNG · up to 10 MB each",
  max = 8,
  accept = ACCEPTED_UPLOADS,
  tiles = false,
}: {
  userId: string;
  scope: Scope;
  name: string;
  label: string;
  hint?: string;
  max?: number;
  accept?: string;
  tiles?: boolean;
}) {
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const id = React.useId();

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(list).slice(0, Math.max(0, max - files.length))) {
        const up = await uploadToStorage(userId, scope, f);
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
    void removeFromStorage(path).catch(() => {});
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-2">
        <label htmlFor={id}>{label}</label>
        {files.length > 0 && <span className="font-normal text-muted"> · {files.length} added</span>}
      </p>
      <input type="hidden" name={name} value={JSON.stringify(files)} />
      <input ref={inputRef} id={id} type="file" multiple accept={accept} className="sr-only" onChange={(e) => void add(e.target.files)} />
      {tiles ? (
        <div className="flex flex-wrap gap-3">
          {files.map((f) => (
            <div key={f.path} className="relative grid size-24 place-items-center rounded-xl bg-mist p-2 text-center">
              <FileText aria-hidden className="size-6 text-muted" />
              <span className="line-clamp-2 text-[11px] text-muted">{f.name}</span>
              <button type="button" onClick={() => remove(f.path)} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line bg-white text-muted hover:text-danger" aria-label={`Remove ${f.name}`}>
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {files.length < max && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="grid size-24 place-items-center rounded-xl border border-dashed border-line text-brand hover:bg-mist disabled:opacity-60"
              aria-label="Add a file"
            >
              {busy ? <span className="text-xs text-muted">Uploading…</span> : <span className="text-3xl leading-none">+</span>}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <FileText aria-hidden className="size-4 text-muted" />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span className="text-xs text-subtle">{formatBytes(f.size)}</span>
              <button type="button" onClick={() => remove(f.path)} className="text-muted hover:text-danger" aria-label={`Remove ${f.name}`}>
                <X className="size-4" />
              </button>
            </div>
          ))}
          {files.length < max && (
            <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
              <Upload aria-hidden className="size-4" /> {busy ? "Uploading…" : files.length ? "Add another file" : "Choose file"}
            </Button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-xs text-subtle">{hint}</p>
      {error && <p className="mt-1.5 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
