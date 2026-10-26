"use client";
import * as React from "react";
import { useActionState } from "react";
import { Building2, User } from "lucide-react";
import { Field, Input, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { signUp } from "../actions";

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, initialActionState);
  const [type, setType] = React.useState<"individual" | "business">("individual");
  const fe = state.fieldErrors ?? {};

  if (state.ok && state.message) {
    return <FormMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink-2">I&apos;m getting cover for</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { v: "individual", label: "Myself or family", icon: User },
              { v: "business", label: "My business", icon: Building2 },
            ] as const
          ).map((o) => (
            <label
              key={o.v}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                type === o.v ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
              )}
            >
              <input type="radio" name="account_type" value={o.v} checked={type === o.v} onChange={() => setType(o.v)} className="sr-only" />
              <o.icon aria-hidden className="size-4" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      {type === "business" && (
        <Field label="Business name" htmlFor="business_name" error={fe.business_name}>
          <Input id="business_name" name="business_name" autoComplete="organization" aria-invalid={!!fe.business_name} />
        </Field>
      )}
      <Field label="Full name" htmlFor="full_name" error={fe.full_name} hint="As it appears on your Ghana Card">
        <Input id="full_name" name="full_name" autoComplete="name" required aria-invalid={!!fe.full_name} />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={fe.phone} hint="Your broker may call or text you about your requests.">
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 123 4567" required aria-invalid={!!fe.phone} />
      </Field>
      <Field label="Email address" htmlFor="email" error={fe.email}>
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required aria-invalid={!!fe.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-invalid={!!fe.password} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Creating your account…">Create account</SubmitButton>
      <p className="text-xs text-subtle">
        Next, we&apos;ll ask you to confirm our terms and how your information is shared with your broker and insurers.
      </p>
    </form>
  );
}
