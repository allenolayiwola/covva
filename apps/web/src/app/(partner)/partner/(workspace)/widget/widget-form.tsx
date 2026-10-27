"use client";
import * as React from "react";
import { useActionState } from "react";
import { Field, Input, Textarea, cn } from "@im/ui";
import { contrastRatio } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "@/components/partner/action-form";

/** Domains, brand colour (with a live WCAG AA check) and logo for the embedded widget. */
export function WidgetSettingsForm({ action, domains, colour, logo, canEdit }: { action: FormAction; domains: string[]; colour: string; logo: string; canEdit: boolean }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [value, setValue] = React.useState(colour || "#00796E");
  const ratio = /^#[0-9a-fA-F]{6}$/.test(value) ? contrastRatio(value) : null;
  const passes = ratio != null && ratio >= 4.5;
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Allowed domains" htmlFor="w-domains" hint="One https origin per line, e.g. https://shop.example.com or https://*.bank.example. The widget only loads inside these sites.">
        <Textarea id="w-domains" name="domains" rows={4} defaultValue={domains.join("\n")} disabled={!canEdit} className="font-mono text-sm" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Brand colour" htmlFor="w-colour" hint="Used for the widget button. White text must stay readable (WCAG AA, 4.5:1).">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Pick a colour" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#00796E"} onChange={(e) => setValue(e.target.value.toUpperCase())} disabled={!canEdit} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white" />
            <Input id="w-colour" name="colour" value={value} onChange={(e) => setValue(e.target.value)} maxLength={7} disabled={!canEdit} className="h-10 font-mono text-sm uppercase" />
          </div>
        </Field>
        <div aria-live="polite" className="flex items-end">
          <div className="w-full space-y-1.5">
            <span className={cn("inline-flex h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white")} style={{ background: /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#00796E" }}>
              Get my quote
            </span>
            <p className={cn("text-xs", passes ? "text-brand-deep" : "text-danger")}>
              {ratio == null ? "Enter a hex colour like #0B6E4F." : passes ? `Contrast ${ratio}:1 — passes WCAG AA.` : `Contrast ${ratio}:1 — too light. Choose a darker shade (needs 4.5:1).`}
            </p>
          </div>
        </div>
      </div>
      <Field label="Logo URL" htmlFor="w-logo" hint="Optional https:// image shown next to the Covva logo.">
        <Input id="w-logo" name="logo" type="url" defaultValue={logo} placeholder="https://example.com/logo.png" disabled={!canEdit} className="h-10 text-sm" />
      </Field>
      {canEdit && (
        <div className="flex items-center gap-3">
          <SubmitButton size="sm" disabled={ratio != null && !passes}>Save widget settings</SubmitButton>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
