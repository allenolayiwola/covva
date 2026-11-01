"use client";

import * as React from "react";
import { useActionState } from "react";
import { CircleCheck } from "lucide-react";
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from "@im/ui";
import { GHANA_REGIONS, SERVICE_PARTNER_KINDS, SERVICE_PARTNER_KIND_LABELS } from "@im/core";
import { applyToNetwork, type JoinState } from "./actions";

const INITIAL: JoinState = { status: "idle" };

export function JoinNetworkForm() {
  const [state, action, pending] = useActionState(applyToNetwork, INITIAL);
  const startedRef = React.useRef<HTMLInputElement>(null);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  React.useEffect(() => {
    if (startedRef.current && !startedRef.current.value) startedRef.current.value = String(Date.now());
  }, []);

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-card border border-line bg-white p-8 text-center">
        <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-full bg-mint text-brand"><CircleCheck className="size-7" /></span>
        <p className="mt-5 text-xl font-semibold tracking-tight text-ink">Thank you — your application is in.</p>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">Our partnerships team checks your details and licences, usually within five working days, and will call you on the number you gave. Approved partners appear in the public directory.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-card border border-line bg-white p-6 sm:p-8" noValidate>
      {state.status === "error" && state.message && <Notice tone="danger">{state.message}</Notice>}
      <input ref={startedRef} type="hidden" name="started" defaultValue="" />
      <div aria-hidden className="hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type of business" htmlFor="kind" error={err.kind}>
          <Select id="kind" name="kind" required defaultValue={v.kind ?? "garage"}>
            {SERVICE_PARTNER_KINDS.map((k) => <option key={k} value={k}>{SERVICE_PARTNER_KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Business name" htmlFor="name" error={err.name}>
          <Input id="name" name="name" required defaultValue={v.name} autoComplete="organization" />
        </Field>
        <Field label="Contact person" htmlFor="contact_name" error={err.contact_name}>
          <Input id="contact_name" name="contact_name" required defaultValue={v.contact_name} autoComplete="name" />
        </Field>
        <Field label="Phone" htmlFor="phone" error={err.phone}>
          <Input id="phone" name="phone" type="tel" required defaultValue={v.phone} autoComplete="tel" placeholder="024 123 4567" />
        </Field>
        <Field label="Email (optional)" htmlFor="email" error={err.email}>
          <Input id="email" name="email" type="email" defaultValue={v.email} autoComplete="email" />
        </Field>
        <Field label="Region" htmlFor="region" error={err.region}>
          <Select id="region" name="region" required defaultValue={v.region ?? ""}>
            <option value="" disabled>Choose a region</option>
            {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Address" htmlFor="address" error={err.address}>
        <Input id="address" name="address" required defaultValue={v.address} autoComplete="street-address" placeholder="Street, area, town" />
      </Field>
      <Field label="Services you offer" htmlFor="services" hint="Separate with commas, e.g. panel beating, spraying, 24-hour towing" error={err.services}>
        <Textarea id="services" name="services" rows={2} defaultValue={v.services} />
      </Field>
      <Field label="Licence or registration (optional)" htmlFor="licence" hint="e.g. Registrar-General number, Health Facilities Regulatory Agency licence" error={err.licence}>
        <Input id="licence" name="licence" defaultValue={v.licence} />
      </Field>
      <Field label="Anything else (optional)" htmlFor="message" hint="Insurers you already work with, direct billing arrangements, opening hours" error={err.message}>
        <Textarea id="message" name="message" rows={3} defaultValue={v.message} />
      </Field>
      <Checkbox name="consent" label="Covva may contact me about this application and share my business details with insurers on the network." />
      {err.consent && <p className="text-xs text-danger">{err.consent}</p>}
      <Button type="submit" loading={pending}>Send application</Button>
    </form>
  );
}
