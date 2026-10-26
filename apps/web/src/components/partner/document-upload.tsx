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
}: {
  customerId: string;
  scope: "policies" | "claims" | "requests";
  kinds: { value: string; label: string }[];
  hidden: Record<string, string>;
  action: FormAction;
  label?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState(kinds[0]?.value ?? "other");
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
      fd.set("files", JSON.stringify(uploaded));
      const res = await action({ ok: false }, fd);
      setState(res);
      if (res.ok) setFiles([]);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-line bg-mist/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field label="Document type" htmlFor={`dk-${hidden.policyId ?? hidden.claimId ?? "x"}`}>
          <Select id={`dk-${hidden.policyId ?? hidden.claimId ?? "x"}`} value={kind} onChange={(e) => setKind(e.currentTarget.value)} className="h-10 text-sm">
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Files" htmlFor={`df-${hidden.policyId ?? hidden.claimId ?? "x"}`} hint="PDF, JPG, PNG or WebP · up to 20 MB each">
          <input
            id={`df-${hidden.policyId ?? hidden.claimId ?? "x"}`}
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
