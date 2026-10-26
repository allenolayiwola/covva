"use client";
import { useState, useTransition } from "react";
import { Button, Field, Select } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { FormMessage, type FormAction, type FormState } from "@/components/partner/action-form";

const MAX = 20 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/**
 * Uploads application documents straight to the private `documents` bucket under
 * `partner-applications/<application id>/…` (storage RLS: the applicant, while the application is
 * editable), then records them on the application through a Server Action.
 */
export function ApplicationDocumentsUpload({
  applicationId,
  type,
  kinds,
  action,
}: {
  applicationId: string;
  type: "insurer" | "broker";
  kinds: { value: string; label: string }[];
  action: FormAction;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState(kinds[0]?.value ?? "other");
  const [state, setState] = useState<FormState>({ ok: false });
  const [pending, start] = useTransition();

  function upload() {
    start(async () => {
      const supabase = createClient();
      const uploaded: { path: string; name: string; kind: string }[] = [];
      for (const f of files) {
        if (f.size > MAX) {
          setState({ ok: false, error: `${f.name} is larger than 20 MB.` });
          return;
        }
        const safe = f.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-80);
        const path = `partner-applications/${applicationId}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (error) {
          setState({ ok: false, error: /mime|type/i.test(error.message) ? `${f.name}: use PDF, JPG, PNG or WebP.` : `Upload failed for ${f.name}: ${error.message}` });
          return;
        }
        uploaded.push({ path, name: f.name, kind });
      }
      const fd = new FormData();
      fd.set("type", type);
      fd.set("applicationId", applicationId);
      fd.set("files", JSON.stringify(uploaded));
      const res = await action({ ok: false }, fd);
      setState(res);
      if (res.ok) setFiles([]);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-line bg-mist/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <Field label="Document type" htmlFor="doc-kind">
          <Select id="doc-kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)} className="h-10 text-sm">
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Files" htmlFor="doc-files" hint="PDF, JPG, PNG or WebP · up to 20 MB each">
          <input
            id="doc-files"
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[10px] file:border-0 file:bg-mint file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-deep"
          />
        </Field>
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={!files.length} loading={pending} onClick={upload}>
        Upload{files.length ? ` ${files.length} file${files.length > 1 ? "s" : ""}` : ""}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}
