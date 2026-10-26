"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ScrollText } from "lucide-react";
import { Button, Notice, Textarea, Label, cn, type ButtonProps } from "@im/ui";
import type { ActionState } from "@/lib/action-state";

export type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size = "sm", className, disabled, ...rest }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} disabled={disabled} className={className} {...rest}>
      {children}
    </Button>
  );
}

export function AuditNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-subtle", className)}>
      <ScrollText className="size-3.5 shrink-0" aria-hidden />
      This action is recorded in the audit log.
    </p>
  );
}

export function ResultNotice({ state, className }: { state: ActionState; className?: string }) {
  if (!state) return null;
  return (
    <Notice tone={state.ok ? "ok" : "danger"} className={cn("py-2.5", className)}>
      <span role={state.ok ? "status" : "alert"}>{state.ok ? state.message ?? "Saved." : state.error}</span>
    </Notice>
  );
}

/**
 * Form bound to a Server Action via useActionState. Shows the result inline and an
 * audit notice. `readOnly` disables the submit button (e.g. support role).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  submitVariant = "primary",
  className,
  audited = true,
  readOnly = false,
  inline = false,
  footer,
}: {
  action: ServerAction;
  children?: React.ReactNode;
  submitLabel?: React.ReactNode;
  submitVariant?: ButtonProps["variant"];
  className?: string;
  audited?: boolean;
  readOnly?: boolean;
  inline?: boolean;
  footer?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  if (inline) {
    return (
      <form action={formAction} className={cn("flex flex-wrap items-center gap-2", className)}>
        {children}
        <SubmitButton variant={submitVariant} disabled={readOnly} title={readOnly ? "Read-only for your role" : undefined}>
          {submitLabel}
        </SubmitButton>
        {state && !state.ok && <span role="alert" className="text-xs text-danger">{state.error}</span>}
        {state?.ok && <span role="status" className="text-xs text-brand">{state.message ?? "Saved."}</span>}
      </form>
    );
  }
  return (
    <form action={formAction} className={cn("space-y-4", className)}>
      {children}
      <ResultNotice state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {audited ? <AuditNote /> : <span />}
        <div className="flex items-center gap-2">
          {footer}
          <SubmitButton variant={submitVariant} disabled={readOnly} title={readOnly ? "Read-only for your role" : undefined}>
            {submitLabel}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

/**
 * Button that opens a confirmation dialog. Destructive or regulated actions
 * require a typed reason (min 5 characters) and optionally a typed confirm word.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  body,
  confirmLabel = "Confirm",
  variant = "danger",
  triggerVariant = "outline",
  requireReason = true,
  reasonLabel = "Reason (recorded in the audit log)",
  confirmWord,
  disabled,
  size = "sm",
  children,
}: {
  action: ServerAction;
  fields?: Record<string, string>;
  label: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
  triggerVariant?: ButtonProps["variant"];
  requireReason?: boolean;
  reasonLabel?: string;
  confirmWord?: string;
  disabled?: boolean;
  size?: ButtonProps["size"];
  /** Extra form fields rendered inside the dialog. */
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, null);
  const [reason, setReason] = useState("");
  const [word, setWord] = useState("");

  // Close the dialog once the action succeeds (DOM sync only; inputs reset on next open).
  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);

  const blocked = (requireReason && reason.trim().length < 5) || (!!confirmWord && word.trim() !== confirmWord);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={size}
        disabled={disabled}
        title={disabled ? "Not available for your role or this record" : undefined}
        onClick={() => {
          setReason("");
          setWord("");
          ref.current?.showModal();
        }}
      >
        {label}
      </Button>
      {state?.ok && <span role="status" className="text-xs text-brand">{state.message}</span>}
      <dialog ref={ref} className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-card border border-line bg-white p-0 shadow-float">
        <form action={formAction} className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {body && <div className="text-sm text-muted">{body}</div>}
          {Object.entries(fields ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          {requireReason && (
            <div>
              <Label htmlFor={`reason-${title}`}>{reasonLabel}</Label>
              <Textarea
                id={`reason-${title}`}
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-20"
              />
            </div>
          )}
          {confirmWord && (
            <div>
              <Label htmlFor={`word-${title}`}>
                Type <code className="rounded bg-mist px-1 font-mono">{confirmWord}</code> to confirm
              </Label>
              <input
                id={`word-${title}`}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                autoComplete="off"
                className="block h-10 w-full rounded-field border border-line px-3 text-sm"
              />
            </div>
          )}
          <ResultNotice state={state && !state.ok ? state : null} />
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <AuditNote />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.close()}>
                Cancel
              </Button>
              <SubmitButton variant={variant} disabled={blocked}>
                {confirmLabel}
              </SubmitButton>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Auto-submitting toggle (checkbox) bound to an action — for flags, appointments, active switches. */
export function ToggleForm({
  action,
  fields,
  checked,
  label,
  disabled,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  checked: boolean;
  label: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="value" value={checked ? "false" : "true"} />
      <button
        type="submit"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled || pending}
        title={disabled ? "Read-only for your role" : label}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand" : "bg-[#C9D3D0]",
          pending && "animate-pulse",
        )}
      >
        <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
      </button>
      {state && !state.ok && <span role="alert" className="max-w-56 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
