"use client";
import * as React from "react";
import { useActionState } from "react";
import { GHANA_REGIONS } from "@im/core";
import { Button, Field, Input, Select } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { setConsent, updateNotificationPrefs, updateProfile } from "./actions";

export interface ProfileValues {
  full_name: string;
  preferred_name: string;
  email: string;
  phone: string;
  region: string;
  city: string;
  date_of_birth: string;
  account_type: "individual" | "business";
  business_name: string;
  ghana_card: string;
  kyc_status: string;
}

export function ProfileForm({ values }: { values: ProfileValues }) {
  const [state, action] = useActionState(updateProfile, initialActionState);
  const [type, setType] = React.useState(values.account_type);
  const fe = state.fieldErrors ?? {};
  const cardLocked = values.kyc_status === "verified";
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="full_name" error={fe.full_name}>
          <Input id="full_name" name="full_name" defaultValue={values.full_name} autoComplete="name" aria-invalid={!!fe.full_name} />
        </Field>
        <Field label={<>What should we call you? <span className="font-normal text-subtle">(optional)</span></>} htmlFor="preferred_name">
          <Input id="preferred_name" name="preferred_name" defaultValue={values.preferred_name} maxLength={60} />
        </Field>
        <Field label="Email" htmlFor="email" hint="Contact support to change your sign-in email.">
          <Input id="email" defaultValue={values.email} disabled />
        </Field>
        <Field label="Mobile number" htmlFor="phone" error={fe.phone}>
          <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={values.phone} autoComplete="tel" aria-invalid={!!fe.phone} />
        </Field>
        <Field label="Region" htmlFor="region" error={fe.region}>
          <Select id="region" name="region" defaultValue={values.region} aria-invalid={!!fe.region}>
            <option value="">Choose…</option>
            {GHANA_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label={<>Town or city <span className="font-normal text-subtle">(optional)</span></>} htmlFor="city">
          <Input id="city" name="city" defaultValue={values.city} autoComplete="address-level2" />
        </Field>
        <Field label={<>Date of birth <span className="font-normal text-subtle">(optional)</span></>} htmlFor="date_of_birth">
          <Input id="date_of_birth" name="date_of_birth" type="date" defaultValue={values.date_of_birth} autoComplete="bday" />
        </Field>
        <Field
          label="Ghana Card number"
          htmlFor="ghana_card"
          error={fe.ghana_card}
          hint={cardLocked ? "Verified. Contact support to change it." : values.kyc_status === "pending" ? "Awaiting verification by our team." : "GHA-123456789-0"}
        >
          <Input id="ghana_card" name="ghana_card" defaultValue={values.ghana_card} disabled={cardLocked} aria-invalid={!!fe.ghana_card} />
        </Field>
        <Field label="Account type" htmlFor="account_type">
          <Select id="account_type" name="account_type" value={type} onChange={(e) => setType(e.target.value as "individual" | "business")}>
            <option value="individual">Individual / family</option>
            <option value="business">Business</option>
          </Select>
        </Field>
        {type === "business" && (
          <Field label="Business name" htmlFor="business_name" error={fe.business_name}>
            <Input id="business_name" name="business_name" defaultValue={values.business_name} autoComplete="organization" aria-invalid={!!fe.business_name} />
          </Field>
        )}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}

export function NotificationsForm({ prefs }: { prefs: Record<string, boolean> }) {
  const [state, action] = useActionState(updateNotificationPrefs, initialActionState);
  const items = [
    { k: "email", label: "Email", body: "Quotes, documents and renewal reminders." },
    { k: "sms", label: "Text message (SMS)", body: "Short alerts when something needs you." },
    { k: "push", label: "App notifications", body: "On the mobile app, when installed." },
    { k: "whatsapp", label: "WhatsApp", body: "Renewal reminders, quote links and payment links on your phone number. We message you only about your cover — never marketing." },
  ];
  return (
    <form action={action} className="space-y-3">
      <ul className="divide-y divide-line rounded-card border border-line">
        {items.map((i) => (
          <li key={i.k}>
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <span>
                <span className="block font-medium text-ink">{i.label}</span>
                <span className="block text-sm text-muted">{i.body}</span>
              </span>
              <input type="checkbox" name={i.k} defaultChecked={!!prefs[i.k]} className="size-5 accent-brand" />
            </label>
          </li>
        ))}
      </ul>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…">Save preferences</SubmitButton>
    </form>
  );
}

export function ConsentToggle({ type, granted }: { type: "marketing" | "ai_assistance"; granted: boolean }) {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={granted ? "outline" : "secondary"}
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await setConsent(type, !granted);
            setMsg(res.ok ? null : res.error ?? "Something went wrong.");
          })
        }
      >
        {granted ? "Withdraw" : "Give consent"}
      </Button>
      {msg && <span role="alert" className="text-xs text-danger">{msg}</span>}
    </span>
  );
}
