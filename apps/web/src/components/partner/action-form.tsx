"use client";
import * as React from "react";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn, type ButtonProps } from "@im/ui";

export interface FormState {
  ok: boolean;
  error?: string;
  message?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

const initial: FormState = { ok: false };

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export function FormMessage({ state, className }: { state: FormState; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cn("rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger", className)}>
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className={cn("rounded-lg bg-mint px-3 py-2 text-sm text-brand-deep", className)}>
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * Generic form bound to a Server Action via useActionState. Shows business-rule errors
 * (e.g. database trigger messages) returned by the action.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  size = "sm",
  className,
  footerClassName,
  resetOnSuccess = false,
  confirm,
  hideSubmit,
  inline,
}: {
  action: FormAction;
  children?: React.ReactNode;
  submitLabel?: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  footerClassName?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  hideSubmit?: boolean;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {!hideSubmit && (
        <div className={cn(inline ? "contents" : "flex flex-wrap items-center gap-3", footerClassName)}>
          <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
            {submitLabel ?? "Save"}
          </SubmitButton>
        </div>
      )}
      <FormMessage state={state} className={inline ? "w-full" : undefined} />
    </form>
  );
}

/** Select that submits its form on change (filters). */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
