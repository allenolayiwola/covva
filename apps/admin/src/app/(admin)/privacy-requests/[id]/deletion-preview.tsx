"use client";
import { useActionState } from "react";
import { DELETION_SCRUBBED, describeRetainedRecords } from "@im/core";
import { ResultNotice, SubmitButton } from "@/components/ui/forms";
import { fulfilDeletion } from "../actions";

type Summary = { scrubbed?: Record<string, number>; retained?: Record<string, number>; has_retained_records?: boolean; storage_paths?: string[] };

/** Dry run of the anonymisation: shows what would be erased and what is kept, without changing anything. */
export function DeletionPreview({ requestId, disabled }: { requestId: string; disabled: boolean }) {
  const [state, action] = useActionState(fulfilDeletion, null);
  const summary = (state?.ok ? state.data : null) as Summary | null;
  const scrubbed = Object.entries(summary?.scrubbed ?? {}).filter(([, n]) => Number(n) > 0);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="dryRun" value="1" />
      <SubmitButton variant="secondary" disabled={disabled}>Preview what will be erased</SubmitButton>
      {state && !state.ok && <ResultNotice state={state} />}
      {summary && (
        <div className="grid gap-4 rounded-card border border-line p-4 text-sm sm:grid-cols-2" aria-live="polite">
          <div>
            <p className="font-semibold text-ink">Would be erased or scrubbed</p>
            <ul className="mt-1 space-y-0.5 text-ink-2">
              {scrubbed.length ? scrubbed.map(([k, n]) => <li key={k}>{k.replace(/_/g, " ")}: {n}</li>) : <li>Profile only</li>}
              {(summary.storage_paths?.length ?? 0) > 0 && <li>stored files: {summary.storage_paths!.length}</li>}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">Kept (insurance records)</p>
            <p className="mt-1 text-ink-2">{describeRetainedRecords(summary.retained).join(", ") || "Nothing to keep — the name is erased too."}</p>
            {summary.has_retained_records && <p className="mt-1 text-[13px] text-muted">The name stays on the retained records; contact details go.</p>}
          </div>
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-[13px] font-medium text-brand">Full scope ({DELETION_SCRUBBED.length} data groups)</summary>
            <ul className="mt-2 space-y-1 text-[13px] text-muted">
              {DELETION_SCRUBBED.map((e) => <li key={e.table}><span className="font-medium text-ink-2">{e.table}:</span> {e.what}</li>)}
            </ul>
          </details>
        </div>
      )}
    </form>
  );
}
