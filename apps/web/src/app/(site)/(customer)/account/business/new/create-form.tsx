"use client";
import { useActionState } from "react";
import { GHANA_REGIONS } from "@im/core";
import { Checkbox, Field, Input, Select } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { createBusinessAction } from "../actions";

const optional = <span className="font-normal text-subtle">(optional)</span>;

/** Create a business account (the signed-in customer becomes its owner). */
export function CreateBusinessForm() {
  const [state, action] = useActionState(createBusinessAction, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate aria-label="Create a business account">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="name" error={fe.name} hint="As customers and staff know it">
          <Input id="name" name="name" required autoComplete="organization" aria-invalid={!!fe.name} />
        </Field>
        <Field label={<>Registered (legal) name {optional}</>} htmlFor="legal_name" error={fe.legal_name}>
          <Input id="legal_name" name="legal_name" aria-invalid={!!fe.legal_name} />
        </Field>
        <Field label="Industry" htmlFor="industry" error={fe.industry} hint="e.g. Retail, Logistics, Hospitality">
          <Input id="industry" name="industry" required aria-invalid={!!fe.industry} />
        </Field>
        <Field label="Number of employees" htmlFor="employees" error={fe.employees}>
          <Input id="employees" name="employees" inputMode="numeric" required aria-invalid={!!fe.employees} />
        </Field>
        <Field label={<>TIN {optional}</>} htmlFor="tin" error={fe.tin} hint="Ghana Revenue Authority taxpayer number">
          <Input id="tin" name="tin" autoComplete="off" aria-invalid={!!fe.tin} />
        </Field>
        <Field label={<>Registration number {optional}</>} htmlFor="registration_number" error={fe.registration_number} hint="Office of the Registrar of Companies">
          <Input id="registration_number" name="registration_number" autoComplete="off" aria-invalid={!!fe.registration_number} />
        </Field>
        <Field label="Billing email" htmlFor="billing_email" error={fe.billing_email} hint="Consolidated statements go here">
          <Input id="billing_email" name="billing_email" type="email" inputMode="email" required aria-invalid={!!fe.billing_email} />
        </Field>
        <Field label="Billing contact" htmlFor="billing_contact" error={fe.billing_contact}>
          <Input id="billing_contact" name="billing_contact" required aria-invalid={!!fe.billing_contact} />
        </Field>
        <Field label={<>Business phone {optional}</>} htmlFor="phone" error={fe.phone}>
          <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="030 123 4567" aria-invalid={!!fe.phone} />
        </Field>
        <Field label={<>Region {optional}</>} htmlFor="region" error={fe.region}>
          <Select id="region" name="region" defaultValue="">
            <option value="">Choose…</option>
            {GHANA_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={<>Address {optional}</>} htmlFor="address" error={fe.address}>
        <Input id="address" name="address" autoComplete="street-address" />
      </Field>
      <div>
        <Checkbox name="authorised" label="I'm authorised to arrange insurance for this business and to share staff details with its broker and insurers." />
        {fe.authorised && <p className="mt-1.5 text-xs text-danger">{fe.authorised}</p>}
      </div>
      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">Covva is a technology platform. Group and commercial cover is arranged by licensed brokers and underwritten by licensed insurers.</p>
        <SubmitButton pendingText="Creating…" className="shrink-0">Create business account</SubmitButton>
      </div>
    </form>
  );
}
