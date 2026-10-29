import { Suspense } from "react";
import type { Row } from "@im/db";
import { Checkbox, Field, Input, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ToggleForm } from "@/components/ui/forms";
import { saveFlag, toggleFlag } from "./actions";

export default function FlagsPage() {
  return (
    <>
      <PageHeader title="Feature flags" description="Switch platform features on and off. Changes apply to the public site and apps after the cache refreshes." />
      <Suspense fallback={<LoadingBlock label="Loading flags…" />}>
        <Flags />
      </Suspense>
    </>
  );
}

async function Flags() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: flags } = await supabase.from("feature_flags").select("*").order("key");
  const people = await profileMap(supabase, (flags ?? []).map((f) => f.updated_by));
  const canAct = can(staff.roles, "platform");
  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canAct} />
      <Table>
        <THead><tr><Th>Flag</Th><Th>Description</Th><Th>Rules</Th><Th>Last changed</Th><Th>Enabled</Th><Th /></tr></THead>
        <tbody>
          {(flags ?? []).map((f) => (
            <tr key={f.key} className="align-top">
              <Td className="font-mono text-sm font-semibold text-ink">{f.key}</Td>
              <Td className="max-w-md text-sm text-ink-2">{f.description ?? "—"}</Td>
              <Td className="font-mono text-xs text-muted">{Object.keys((f.rules as object) ?? {}).length ? JSON.stringify(f.rules) : "—"}</Td>
              <Td className="text-xs text-muted">{formatDateTime(f.updated_at)}{f.updated_by && <p>{personName(people.get(f.updated_by))}</p>}</Td>
              <Td><ToggleForm action={toggleFlag} fields={{ key: f.key }} checked={f.enabled} label={`Toggle ${f.key}`} disabled={!canAct} /></Td>
              <Td>
                <details>
                  <summary className="cursor-pointer text-sm text-brand">Edit</summary>
                  <div className="mt-3 w-[min(520px,80vw)]"><FlagForm flag={f} canAct={canAct} /></div>
                </details>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Panel title="New flag"><FlagForm canAct={canAct} /></Panel>
    </div>
  );
}

function FlagForm({ flag, canAct }: { flag?: Row<"feature_flags">; canAct: boolean }) {
  const idp = flag?.key ?? "new";
  return (
    <ActionForm action={saveFlag} submitLabel="Save flag" readOnly={!canAct}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Key" htmlFor={`fk-${idp}`}>
          <Input id={`fk-${idp}`} name="key" required defaultValue={flag?.key ?? ""} readOnly={!!flag} className={flag ? "bg-mist font-mono" : "font-mono"} />
        </Field>
        <div className="flex items-end pb-2"><Checkbox name="enabled" defaultChecked={flag?.enabled ?? false} label="Enabled" /></div>
        <Field label="Description" htmlFor={`fd-${idp}`} className="sm:col-span-2"><Input id={`fd-${idp}`} name="description" defaultValue={flag?.description ?? ""} /></Field>
        <Field label="Rules (JSON object, optional)" htmlFor={`fr-${idp}`} className="sm:col-span-2" hint='e.g. {"orgs":["…"],"percent":10} — interpreted by the apps'>
          <Textarea id={`fr-${idp}`} name="rules" defaultValue={flag && Object.keys((flag.rules as object) ?? {}).length ? JSON.stringify(flag.rules, null, 2) : ""} className="min-h-20 font-mono text-xs" />
        </Field>
      </div>
    </ActionForm>
  );
}
