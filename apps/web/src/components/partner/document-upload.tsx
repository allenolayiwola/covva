"use client";
import { useState, useTransition } from "react";
import { documentPath } from "@im/db";
import { Button, Field, Select } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { FormMessage, type FormAction, type FormState } from "./action-form";

const MAX = 20 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/**
 * Uploads files straight to the private `documents` bucket with the signed-in member's
 * session (storage RLS lets active org members insert), under `{customerId}/{scope}/…`,
 * then records the `documents` rows through a Server Action.
 */
export function DocumentUpload({
  customerId,
  scope,
  kinds,
  hidden,
  action,
  label = "Upload documents",
  tasks,
  hint,
}: {
  customerId: string;
  scope: "policies" | "claims" | "requests";
  kinds: { value: string; label: string }[];
  hidden: Record<string, string>;
  action: FormAction;
  label?: string;
  /** Open customer tasks the upload may complete (adds a "Completes task" select → `taskId`). */
  tasks?: { id: string; title: string; documentKind?: string | null }[];
  hint?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState(kinds[0]?.value ?? "other");
  const [taskId, setTaskId] = useState("");
  const key = hidden.policyId ?? hidden.claimId ?? hidden.requestId ?? "x";
  const [state, setState] = useState<FormState>({ ok: false });
  const [pending, start] = useTransition();

  function upload() {
    start(async () => {
      const supabase = createClient();
      const uploaded: { path: string; name: string; mime: string; size: number; kind: string }[] = [];
      for (const f of files) {
        if (f.size > MAX) {
          setState({ ok: false, error: `${f.name} is larger than 20 MB.` });
          return;
        }
        const path = documentPath(customerId, scope, f.name);
        const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type, upsert: false });
        if (error) {
          setState({ ok: false, error: `Upload failed for ${f.name}: ${error.message}` });
          return;
        }
        uploaded.push({ path, name: f.name, mime: f.type, size: f.size, kind });
      }
      const fd = new FormData();
      for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
      if (taskId) fd.set("taskId", taskId);
      fd.set("files", JSON.stringify(uploaded));
      const res = await action({ ok: false }, fd);
      setState(res);
      if (res.ok) setFiles([]);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-line bg-mist/40 p-4">
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field label="Document type" htmlFor={`dk-${key}`}>
          <Select id={`dk-${key}`} value={kind} onChange={(e) => setKind(e.currentTarget.value)} className="h-10 text-sm">
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        {tasks && tasks.length > 0 && (
          <Field label="Completes task" htmlFor={`dt-${key}`} className="sm:col-span-2">
            <Select
              id={`dt-${key}`}
              value={taskId}
              onChange={(e) => {
                const id = e.currentTarget.value;
                setTaskId(id);
                const t = tasks.find((x) => x.id === id);
                if (t?.documentKind && kinds.some((k) => k.value === t.documentKind)) setKind(t.documentKind);
              }}
              className="h-10 text-sm"
            >
              <option value="">No task — just attach to the request</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Files" htmlFor={`df-${key}`} hint="PDF, JPG, PNG or WebP · up to 20 MB each">
          <input
            id={`df-${key}`}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[10px] file:border-0 file:bg-mint file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-deep"
          />
        </Field>
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={!files.length} loading={pending} onClick={upload}>
        {label}{files.length ? ` (${files.length})` : ""}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}
