import Link from "next/link";
import { PenLine } from "lucide-react";
import { ENDORSEMENT_STATUS, adjustmentLabel, endorsementKindsFor, formatDate, type EndorsementKind, type EndorsementStatus } from "@im/core";
import { Card, Pill } from "@im/ui";
import type { Supabase } from "@/app/(customer)/account/_lib/data";
import { requestPolicyChange } from "@/app/(customer)/account/policies/[id]/change-actions";
import { PolicyChangeForm } from "./policy-change-form";

/**
 * "Make a change" on the policy page (endorsements): the changes available for this category, each a
 * structured form, plus the customer's change requests and their status. Reads go through RLS.
 */
export async function PolicyChangesSection({ supabase, policy }: { supabase: Supabase; policy: { id: string; status: string; external_source: boolean; cover_end: string | null; insured_items: unknown; sum_insured: number | null; category: { slug: string; name: string } | null } }) {
  if (policy.external_source) return null;
  const { data: changes } = await supabase.from("endorsements").select("id, reference, kind, status, effective_from, premium_adjustment, currency, created_at").eq("policy_id", policy.id).order("created_at", { ascending: false }).limit(10);
  const kinds = endorsementKindsFor(policy.category?.slug);
  const risk = ((policy.insured_items ?? {}) as { risk?: Record<string, unknown> }).risk ?? {};
  const prefill: Record<string, string> = {};
  for (const k of kinds) for (const f of k.fields) if (f.riskKey && risk[f.riskKey] != null) prefill[f.key] = String(risk[f.riskKey]);
  if (policy.sum_insured != null) prefill.sum_insured = String(policy.sum_insured);
  const canChange = policy.status === "active";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-labelledby="changes-h" id="changes" className="scroll-mt-24">
      <h2 id="changes-h" className="flex items-center gap-2 text-lg font-semibold text-ink"><PenLine aria-hidden className="size-5 text-brand" /> Make a change</h2>
      <p className="mt-1 text-sm text-muted">Tell us what has changed. Your broker or insurer checks it and the insurer confirms any change in premium before your policy is updated.</p>
      {(changes ?? []).length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {(changes ?? []).map((c) => {
            const meta = ENDORSEMENT_STATUS[c.status as EndorsementStatus] ?? { label: c.status, tone: "neutral" as const };
            return (
              <li key={c.id}>
                <Link href={`/account/policies/${policy.id}/changes/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-mist/50">
                  <span>
                    <span className="font-medium text-ink">{kinds.find((k) => k.kind === c.kind)?.label ?? c.kind}</span>
                    <span className="text-muted"> · {c.reference} · from {formatDate(c.effective_from)}</span>
                    <span className="block text-xs text-subtle">{adjustmentLabel(c.premium_adjustment, c.currency)}</span>
                  </span>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {canChange ? (
        <Card className="mt-3 divide-y divide-line p-0">
          {kinds.map((k) => (
            <details key={k.kind} className="group px-4 py-3" data-kind={k.kind}>
              <summary className="cursor-pointer list-none font-medium text-ink marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-3">{k.label}<span aria-hidden className="text-subtle transition group-open:rotate-90">›</span></span>
              </summary>
              <div className="pt-3">
                <PolicyChangeForm kind={k.kind as EndorsementKind} action={requestPolicyChange.bind(null, policy.id)} prefill={prefill} minDate={today} maxDate={policy.cover_end} />
              </div>
            </details>
          ))}
        </Card>
      ) : (
        <p className="mt-3 text-sm text-muted">Changes can be requested once the policy is active.</p>
      )}
    </section>
  );
}
