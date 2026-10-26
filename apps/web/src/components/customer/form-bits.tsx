"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice, type ButtonProps } from "@im/ui";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ActionState } from "./utils";

/** Submit button that shows a spinner while its parent form's action is pending. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** Renders an action result (error or success) as an accessible live region. */
export function FormMessage({ state, className }: { state: ActionState | undefined; className?: string }) {
  if (!state || (!state.error && !state.message)) return <div aria-live="polite" className="sr-only" />;
  return (
    <div aria-live="polite" className={className}>
      {state.error ? (
        <Notice tone="danger" icon={<TriangleAlert className="size-4" />}>{state.error}</Notice>
      ) : (
        <Notice tone="ok" icon={<CircleCheck className="size-4" />}>{state.message}</Notice>
      )}
    </div>
  );
}

export function FieldError({ state, name }: { state: ActionState | undefined; name: string }) {
  const msg = state?.fieldErrors?.[name];
  if (!msg) return null;
  return <p id={`${name}-error`} className="mt-1.5 text-xs text-danger">{msg}</p>;
}
