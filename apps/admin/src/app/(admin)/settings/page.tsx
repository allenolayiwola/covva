import { Suspense } from "react";
import { Field, Input, Pill, Textarea } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { KNOWN_SETTINGS, READ_ONLY_PREFIXES } from "@/lib/settings-schema";
import { LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { saveSetting } from "./actions";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Platform-wide configuration stored in platform_settings. Known keys are validated before saving; every change is audited." />
      <Suspense fallback={<LoadingBlock label="Loading settings…" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: rows } = await supabase.from("platform_settings").select("*").order("key");
  const people = await profileMap(supabase, (rows ?? []).map((r) => r.updated_by));
  const canAct = can(staff.roles, "platform");
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  const knownKeys = Object.keys(KNOWN_SETTINGS);
  const otherKeys = (rows ?? []).map((r) => r.key).filter((k) => !knownKeys.includes(k) && !READ_ONLY_PREFIXES.some((p) => k.startsWith(p)));
  const readOnly = (rows ?? []).filter((r) => READ_ONLY_PREFIXES.some((p) => r.key.startsWith(p)));

  const editor = (key: string) => {
    const row = byKey.get(key);
    const known = KNOWN_SETTINGS[key];
    return (
      <Panel
        key={key}
        title={<span className="font-mono">{key}</span>}
        description={known?.hint ?? row?.description ?? undefined}
        actions={row ? <span className="text-xs text-muted">Updated {formatDateTime(row.updated_at)}{row.updated_by ? ` by ${personName(people.get(row.updated_by))}` : ""}</span> : <Pill tone="wait">Not set</Pill>}
      >
        <ActionForm action={saveSetting} submitLabel="Save" readOnly={!canAct}>
          <input type="hidden" name="key" value={key} />
          <Textarea name="value" aria-label={`${key} JSON value`} defaultValue={JSON.stringify(row?.value ?? known?.example ?? null, null, 2)} className="min-h-28 font-mono text-xs" />
          <Input name="description" aria-label="Description" defaultValue={row?.description ?? known?.hint ?? ""} placeholder="Description" className="h-9 text-sm" />
        </ActionForm>
      </Panel>
    );
  };

  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canAct} />
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">Validated settings</h2>
      <div className="grid gap-6 xl:grid-cols-2">{knownKeys.map(editor)}</div>
      {otherKeys.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">Other settings</h2>
          <div className="grid gap-6 xl:grid-cols-2">{otherKeys.map(editor)}</div>
        </>
      )}
      {readOnly.length > 0 && (
        <Panel title="Written by background jobs" description="Read-only here (see System health).">
          <ul className="space-y-1 font-mono text-xs">
            {readOnly.map((r) => <li key={r.key}>{r.key} = {JSON.stringify(r.value)}</li>)}
          </ul>
        </Panel>
      )}
      <Panel title="Add a setting">
        <ActionForm action={saveSetting} submitLabel="Add setting" readOnly={!canAct}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" htmlFor="new-key"><Input id="new-key" name="key" required className="font-mono" /></Field>
            <Field label="Description" htmlFor="new-desc"><Input id="new-desc" name="description" /></Field>
            <Field label="Value (JSON)" htmlFor="new-val" className="sm:col-span-2" hint='Strings need quotes: "value". Numbers, arrays and objects as JSON.'>
              <Textarea id="new-val" name="value" required className="min-h-20 font-mono text-xs" />
            </Field>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
