"use client";
import { FieldErrors } from "@/components/ui/forms";
import { useActionState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Notice, Pill } from "@im/ui";
import { SubmitButton } from "@/components/ui/forms";
import type { SimulationResult } from "./types";
import type { ActionState } from "@/lib/action-state";

const ctl = "mt-1 block h-10 w-full rounded-field border border-line bg-white px-3 text-sm";

export function RoutingSimulator({
  action,
  categories,
  regions,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  categories: { id: string; name: string; segment: string }[];
  regions: readonly string[];
}) {
  const [state, formAction] = useActionState(action, null);
  const result = state?.ok ? (state.data as SimulationResult) : null;

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-4">
        <FieldErrors state={state} />
        <label className="text-sm font-medium text-ink-2 sm:col-span-2">
          Category
          <select name="categoryId" required className={ctl} defaultValue="">
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink-2">
          Customer region
          <select name="region" className={ctl} defaultValue="">
            <option value="">Any</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink-2">
          Segment
          <select name="segment" className={ctl} defaultValue="">
            <option value="">Any</option>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="specialist">Specialist</option>
          </select>
        </label>
        <div className="sm:col-span-4">
          <SubmitButton variant="secondary">Simulate routing</SubmitButton>
          <span className="ml-3 text-xs text-muted">Read-only — uses live rules, licences, appointments, today&apos;s load and 30-day SLA performance. Nothing is changed.</span>
        </div>
      </form>
      {state && !state.ok && <Notice tone="danger">{state.error}</Notice>}
      {result && (
        <div className="space-y-3">
          <Notice tone={result.decision.brokerOrgId ? "ok" : "wait"} title={result.decision.brokerOrgId ? "Would route to" : "No eligible broker"}>
            {result.decision.reason}
          </Notice>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {result.decision.considered
              .slice()
              .sort((a, b) => (a.score ?? 1e9) - (b.score ?? 1e9))
              .map((c) => {
                const cand = result.candidates.find((x) => x.brokerOrgId === c.brokerOrgId);
                const chosen = c.brokerOrgId === result.decision.brokerOrgId;
                return (
                  <li key={c.brokerOrgId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    {c.eligible ? <CheckCircle2 className="size-4 text-brand" /> : <XCircle className="size-4 text-danger" />}
                    <span className="font-medium text-ink">{result.names[c.brokerOrgId] ?? c.brokerOrgId}</span>
                    {chosen && <Pill tone="ok">Selected</Pill>}
                    <span className="text-muted">{c.why}</span>
                    {cand && (
                      <span className="ml-auto text-xs text-subtle">
                        priority {cand.priority} · {cand.insurerAccess} insurers · {cand.openToday}/{cand.dailyCapacity ?? "∞"} today · SLA breach {Math.round((cand.slaBreachRate30d ?? 0) * 100)}%
                        {c.score !== undefined && ` · score ${c.score.toFixed(1)}`}
                      </span>
                    )}
                  </li>
                );
              })}
            {!result.decision.considered.length && <li className="px-4 py-3 text-sm text-muted">No active routing rules for this category.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
