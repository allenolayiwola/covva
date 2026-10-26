"use client";
import * as React from "react";
import { useActionState } from "react";
import { ArrowUp, FileText, Plus, X } from "lucide-react";
import { Button, Spinner } from "@im/ui";
import { removeFromStorage, uploadToStorage } from "@/components/customer/upload";
import { ACCEPTED_UPLOADS, initialActionState, type ActionState, type UploadedFile } from "@/components/customer/utils";
import { markThreadRead, sendMessage } from "./actions";

export function Composer({ requestId, userId }: { requestId: string; userId: string }) {
  const [state, action, pending] = useActionState(sendMessage.bind(null, requestId) as (s: ActionState, f: FormData) => Promise<ActionState>, initialActionState);
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const draftKey = `im:msg-draft:${requestId}`;

  // Resumable drafts
  React.useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a draft from localStorage after hydration
      if (d) setBody(d);
    } catch {}
  }, [draftKey]);
  React.useEffect(() => {
    try {
      if (body) localStorage.setItem(draftKey, body);
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [body, draftKey]);

  // Reset after a successful send
  const lastState = React.useRef(state);
  React.useEffect(() => {
    if (state !== lastState.current && state.ok) {
      setBody("");
      setFiles([]);
    }
    lastState.current = state;
  }, [state]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const f of Array.from(list).slice(0, 5 - files.length)) {
        const up = await uploadToStorage(userId, "requests", f);
        setFiles((prev) => [...prev, up]);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form ref={formRef} action={action} className="border-t border-line bg-white p-3">
      <input type="hidden" name="attachments" value={JSON.stringify(files)} />
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.path} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1 text-xs text-ink-2">
              <FileText aria-hidden className="size-3.5" /> {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  setFiles((prev) => prev.filter((x) => x.path !== f.path));
                  void removeFromStorage(f.path).catch(() => {});
                }}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(state.error || uploadError) && <p role="alert" className="mb-2 text-xs text-danger">{uploadError ?? state.error}</p>}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple accept={ACCEPTED_UPLOADS} className="sr-only" id="msg-file" onChange={(e) => void addFiles(e.target.files)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || files.length >= 5}
          className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-mist hover:text-ink disabled:opacity-50"
          aria-label="Attach a document"
        >
          {uploading ? <Spinner className="size-4" /> : <Plus className="size-5" />}
        </button>
        <label htmlFor="msg-body" className="sr-only">Message</label>
        <textarea
          id="msg-body"
          name="body"
          rows={1}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (body.trim() || files.length) formRef.current?.requestSubmit();
            }
          }}
          placeholder="Message"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-line px-4 py-2.5 text-[15px] text-ink placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <Button type="submit" className="size-11 shrink-0 rounded-full p-0" loading={pending} disabled={uploading || (!body.trim() && !files.length)} aria-label="Send">
          {!pending && <ArrowUp className="size-5" />}
        </Button>
      </div>
    </form>
  );
}

/** Marks the thread read on open and whenever a new broker message arrives (read receipts). */
export function MarkRead({ requestId, latest }: { requestId: string; latest: string | null }) {
  React.useEffect(() => {
    if (latest) void markThreadRead(requestId);
  }, [requestId, latest]);
  return null;
}
