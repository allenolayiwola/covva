"use client";
import { useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { FormMessage, type FormAction, type FormState } from "@/components/partner/action-form";

const MAX = 20 * 1024 * 1024;

/**
 * "Insurer not on Covva": uploads the appointment letter to the private documents bucket under
 * `appointment-letters/<broker org id>/…` (storage RLS: active org members), then records the
 * admin-review request and the partnerships lead through a Server Action.
 */
export function AppointmentLetterForm({ brokerOrgId, categories, action }: { brokerOrgId: string; categories: { id: string; name: string }[]; action: FormAction }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<FormState>({ ok: false });
  const [pending, start] = useTransition();

  function submit(form: HTMLFormElement) {
    start(async () => {
      if (!file) return setState({ ok: false, error: "Attach the appointment letter (PDF or image)." });
      if (file.size > MAX) return setState({ ok: false, error: "The letter must be under 20 MB." });
      const supabase = createClient();
      const safe = file.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-80);
      const path = `appointment-letters/${brokerOrgId}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) return setState({ ok: false, error: `Upload failed: ${error.message}` });
      const fd = new FormData(form);
      fd.delete("letter");
      fd.set("letterPath", path);
      const res = await action({ ok: false }, fd);
      setState(res);
      if (res.ok) {
        form.reset();
        setFile(null);
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insurer name" htmlFor="al-name"><Input id="al-name" name="proposedInsurerName" required placeholder="e.g. Star Assurance" /></Field>
        <Field label="Product line" htmlFor="al-cat">
          <Select id="al-cat" name="categoryId" required defaultValue="">
            <option value="" disabled>Choose a line</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Insurer contact email (optional)" htmlFor="al-email" hint="Helps our partnerships team invite them to Covva."><Input id="al-email" name="contactEmail" type="email" /></Field>
        <Field label="Appointment letter" htmlFor="al-file" hint="PDF, JPG or PNG · up to 20 MB">
          <input id="al-file" name="letter" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[10px] file:border-0 file:bg-mint file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-deep" />
        </Field>
        <Field label="Note for Covva (optional)" htmlFor="al-note" className="sm:col-span-2"><Textarea id="al-note" name="note" rows={2} /></Field>
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Send for Covva review</Button>
      <FormMessage state={state} />
    </form>
  );
}
