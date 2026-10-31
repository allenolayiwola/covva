"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Notice } from "@im/ui";
import { FieldErrors, SubmitButton } from "@/components/ui/forms";
import type { ActionState } from "@/lib/action-state";

export function VerifyChain({ action, disabled }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; disabled: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const d = state?.data as { ok: boolean; firstBadId: number | null } | undefined;
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <FieldErrors state={state} />
        <label className="text-sm text-muted">
          Check up to{" "}
          <select name="limit" defaultValue="10000" className="h-9 rounded-md border border-line bg-white px-2 text-sm">
            <option value="10000">10,000</option>
            <option value="100000">100,000</option>
            <option value="1000000">1,000,000</option>
          </select>{" "}
          events
        </label>
        <SubmitButton variant="primary" disabled={disabled} title={disabled ? "Platform admin or compliance only" : undefined}>
          <ShieldCheck className="size-4" aria-hidden /> Verify chain
        </SubmitButton>
      </form>
      {state && !state.ok && <Notice tone="danger">{state.error}</Notice>}
      {state?.ok && d && (
        <Notice tone={d.ok ? "ok" : "danger"} icon={d.ok ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />} title={d.ok ? "Audit chain intact" : "Audit chain broken"}>
          {state.message}{" "}
          {!d.ok && d.firstBadId != null && (
            <Link className="font-semibold underline" href={`/audit?from_id=${d.firstBadId}`}>Inspect event #{d.firstBadId}</Link>
          )}
        </Notice>
      )}
    </div>
  );
}
