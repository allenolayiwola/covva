"use client";
import * as React from "react";
import { useActionState } from "react";
import { Info, Search } from "lucide-react";
import { ENDORSEMENT_KINDS, prefillFromLookup, type EndorsementKind, type VehicleData } from "@im/core";
import { Button, Field, Input, Notice, Select, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "./form-bits";
import { initialActionState, type ActionState } from "./utils";

/**
 * Structured form for one kind of policy change. Field definitions come from @im/core ENDORSEMENT_KINDS
 * (the server re-validates with the same zod schema). Change of vehicle can prefill from the
 * registration lookup.
 */
export function PolicyChangeForm({ kind, action, prefill, minDate, maxDate }: { kind: EndorsementKind; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; prefill: Record<string, string>; minDate: string; maxDate?: string | null }) {
  const def = ENDORSEMENT_KINDS[kind];
  const [state, formAction] = useActionState(action, initialActionState);
  const [values, setValues] = React.useState<Record<string, string>>(kind === "change_vehicle" ? {} : prefill);
  const [lookup, setLookup] = React.useState<"idle" | "searching" | "found" | "none" | "error">("idle");
  const uid = React.useId();
  const id = (k: string) => `${uid}-${k}`;

  async function runLookup() {
    const reg = (values.registration_number ?? "").trim();
    if (reg.length < 4) return;
    setLookup("searching");
    try {
      const res = await fetch("/api/v1/lookups/vehicle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration: reg }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: { found?: boolean; data?: VehicleData; registration?: string } } | null;
      if (!res.ok || !json?.ok) throw new Error("lookup failed");
      const data = json.data?.data;
      if (json.data?.found && data) {
        setValues((prev) => ({ ...(prefillFromLookup({ ...prev, registration_number: json.data?.registration ?? reg }, data) as Record<string, string>) }));
        setLookup("found");
      } else setLookup("none");
    } catch {
      setLookup("error");
    }
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <p className="text-sm text-muted">{def.description}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.map((f) => {
          const common = { id: id(f.key), name: f.key, required: f.required, value: values[f.key] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [f.key]: e.target.value })) };
          const control =
            f.type === "textarea" ? <Textarea {...common} rows={2} className="min-h-16 text-sm" />
            : f.type === "select" ? (
              <Select {...common}>
                <option value="" disabled>Choose…</option>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            )
            : <Input {...common} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} min={f.type === "number" ? 0 : undefined} step={f.key === "vehicle_year" || f.key === "years_licensed" ? 1 : f.type === "number" ? "any" : undefined} />;
          return (
            <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
              <Field label={f.label} htmlFor={id(f.key)} hint={f.hint}>
                {f.key === "registration_number" && kind === "change_vehicle" ? (
                  <div className="flex gap-2">
                    {control}
                    <Button type="button" variant="secondary" size="sm" onClick={runLookup} loading={lookup === "searching"} aria-label="Look up the vehicle from its registration"><Search aria-hidden className="size-4" /> Look up</Button>
                  </div>
                ) : control}
              </Field>
            </div>
          );
        })}
        <Field label="Change starts on" htmlFor={id("effective_from")}>
          <Input id={id("effective_from")} name="effective_from" type="date" required min={minDate} max={maxDate ?? undefined} defaultValue={minDate} />
        </Field>
      </div>
      {lookup === "found" && <p className="text-xs text-brand-deep">We filled in the make, model and year from the registration. Check them and add the value.</p>}
      {lookup === "none" && <p className="text-xs text-muted">We couldn&apos;t find that registration. Enter the details yourself.</p>}
      {lookup === "error" && <p className="text-xs text-muted">The lookup isn&apos;t available right now. Enter the details yourself.</p>}
      <Notice tone="info" icon={<Info className="size-4" />}>Your insurer will confirm any change in premium before anything changes on your policy. Your cover stays as it is until the insurer confirms.</Notice>
      <SubmitButton size="sm" pendingText="Sending…">Send to {kind === "cancel_policy" ? "the insurer" : "my broker / insurer"}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
