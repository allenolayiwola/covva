"use client";
import { useActionState } from "react";
import { GHANA_REGIONS, RELATIONSHIPS } from "@im/core";
import { Field, Input, Select, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { addBeneficiary, editBeneficiary } from "../../actions";

export interface BeneficiaryValues {
  id?: string;
  full_name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;
  ghana_card?: string;
  address?: string;
  region?: string;
  notes?: string;
}

export function BeneficiaryForm({ values = {}, mode = "create" }: { values?: BeneficiaryValues; mode?: "create" | "edit" }) {
  const [state, action] = useActionState(mode === "edit" ? editBeneficiary : addBeneficiary, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate aria-label={mode === "edit" ? "Edit family member" : "Add a family member"}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="full_name" error={fe.full_name} hint="As on their Ghana Card">
          <Input id="full_name" name="full_name" defaultValue={values.full_name} autoComplete="off" required aria-invalid={!!fe.full_name} />
        </Field>
        <Field label="Relationship to you" htmlFor="relationship" error={fe.relationship}>
          <Select id="relationship" name="relationship" defaultValue={values.relationship ?? ""} required aria-invalid={!!fe.relationship}>
            <option value="">Choose…</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Their mobile number (Ghana)" htmlFor="phone" error={fe.phone} hint="The consent code goes to this number.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={values.phone} placeholder="024 123 4567" required aria-invalid={!!fe.phone} />
        </Field>
        <Field label={<>Email <span className="font-normal text-subtle">(optional)</span></>} htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" inputMode="email" defaultValue={values.email} aria-invalid={!!fe.email} />
        </Field>
        <Field label={<>Date of birth <span className="font-normal text-subtle">(optional)</span></>} htmlFor="date_of_birth" error={fe.date_of_birth} hint="Insurers price health and funeral cover by age.">
          <Input id="date_of_birth" name="date_of_birth" type="date" defaultValue={values.date_of_birth} aria-invalid={!!fe.date_of_birth} />
        </Field>
        <Field label={<>Ghana Card number <span className="font-normal text-subtle">(optional)</span></>} htmlFor="ghana_card" error={fe.ghana_card} hint="GHA-123456789-0. Shown masked everywhere.">
          <Input id="ghana_card" name="ghana_card" defaultValue={values.ghana_card} autoComplete="off" aria-invalid={!!fe.ghana_card} />
        </Field>
        <Field label={<>Region <span className="font-normal text-subtle">(optional)</span></>} htmlFor="region" error={fe.region}>
          <Select id="region" name="region" defaultValue={values.region ?? ""}>
            <option value="">Choose…</option>
            {GHANA_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label={<>Address <span className="font-normal text-subtle">(optional)</span></>} htmlFor="address" error={fe.address}>
          <Input id="address" name="address" defaultValue={values.address} autoComplete="off" />
        </Field>
      </div>
      <Field label={<>Notes for your broker <span className="font-normal text-subtle">(optional)</span></>} htmlFor="notes" error={fe.notes}>
        <Textarea id="notes" name="notes" defaultValue={values.notes} maxLength={1000} rows={3} />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">Their details stay private until they consent. Ghana&apos;s Data Protection Act (Act 843) applies.</p>
        <SubmitButton pendingText="Saving…" className="shrink-0">{mode === "edit" ? "Save changes" : "Add and send consent code"}</SubmitButton>
      </div>
    </form>
  );
}
