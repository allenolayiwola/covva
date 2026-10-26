"use client";
import { useActionState, useState, useTransition } from "react";
import { Button, Checkbox, Field, Input, Notice, Select } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { FormMessage, SubmitButton, type FormAction, type FormState } from "./action-form";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); }}>
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

/** API key creation: the secret is returned once by the action and never stored in plain text. */
export function ApiKeyForm({ action, scopes }: { action: FormAction; scopes: readonly string[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const secret = typeof state.data?.secret === "string" ? state.data.secret : null;
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Key name" htmlFor="ak-name"><Input id="ak-name" name="name" required className="h-10 text-sm" placeholder="Core system integration" /></Field>
        <Field label="Expires" htmlFor="ak-exp">
          <Select id="ak-exp" name="expires" className="h-10 text-sm" defaultValue="365">
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
            <option value="0">Never</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-2">Scopes</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopes.map((s) => <Checkbox key={s} name="scopes" value={s} label={<code className="text-xs">{s}</code>} defaultChecked={s.endsWith(":read")} />)}
        </div>
      </fieldset>
      <SubmitButton pendingLabel="Creating…">Create API key</SubmitButton>
      {secret ? (
        <Notice tone="wait" title="Copy this key now — it won't be shown again">
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs text-ink">{secret}</code>
            <CopyButton text={secret} />
          </div>
          <p className="mt-2 text-xs">We store only a SHA-256 hash. Send it as <code>Authorization: Bearer &lt;key&gt;</code>.</p>
        </Notice>
      ) : <FormMessage state={state} />}
    </form>
  );
}

/** Invitation form that shows the invite link after creation. */
export function InviteForm({ action, roles, teams }: { action: FormAction; roles: readonly string[]; teams: string[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const link = typeof state.data?.link === "string" ? state.data.link : null;
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Email" htmlFor="iv-email"><Input id="iv-email" name="email" type="email" required className="h-10 text-sm" /></Field>
        <Field label="Role" htmlFor="iv-role">
          <Select id="iv-role" name="role" className="h-10 text-sm" defaultValue={roles.includes("adviser") ? "adviser" : roles[1]}>
            {roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</option>)}
          </Select>
        </Field>
        <Field label="Team" htmlFor="iv-team">
          <Input id="iv-team" name="team" list="iv-teams" className="h-10 text-sm" />
          <datalist id="iv-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
      </div>
      <SubmitButton pendingLabel="Inviting…">Invite member</SubmitButton>
      <FormMessage state={state} />
      {link && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Invitation link: <code className="break-all rounded bg-mist px-2 py-1 text-ink">{typeof window !== "undefined" ? window.location.origin : ""}{link}</code>
          <CopyButton text={`${typeof window !== "undefined" ? window.location.origin : ""}${link}`} />
        </div>
      )}
    </form>
  );
}

/** Logo upload to the public org-assets bucket under `{orgId}/…` (storage RLS: org members). */
export function LogoUpload({ orgId, current, action }: { orgId: string; current: string | null; action: FormAction }) {
  const [state, setState] = useState<FormState>({ ok: false });
  const [preview, setPreview] = useState<string | null>(current);
  const [pending, start] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setState({ ok: false, error: "Logos must be under 5 MB." });
    start(async () => {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${orgId}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("org-assets").upload(path, file, { contentType: file.type, upsert: false });
      if (error) return setState({ ok: false, error: `Upload failed: ${error.message}` });
      const { data } = supabase.storage.from("org-assets").getPublicUrl(path);
      const fd = new FormData();
      fd.set("url", data.publicUrl);
      const res = await action({ ok: false }, fd);
      setState(res);
      if (res.ok) setPreview(data.publicUrl);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid size-16 place-items-center overflow-hidden rounded-xl border border-line bg-mist">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="Organisation logo" className="size-full object-contain" /> : <span className="text-xs text-subtle">No logo</span>}
      </div>
      <div className="space-y-1">
        <label className="inline-flex cursor-pointer items-center rounded-[10px] bg-mint px-3.5 py-2 text-sm font-semibold text-brand-deep hover:bg-[#cfe7da]">
          {pending ? "Uploading…" : "Upload logo"}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={(e) => onFile(e.currentTarget.files?.[0])} disabled={pending} />
        </label>
        <p className="text-xs text-subtle">PNG, JPG, SVG or WebP · up to 5 MB</p>
        <FormMessage state={state} />
      </div>
    </div>
  );
}
