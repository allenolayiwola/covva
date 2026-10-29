import { Suspense } from "react";
import { Checkbox, Field, Input, Notice, Pill, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import {
  LOYALTY_DISCOUNT_NOTE,
  LOYALTY_RULE_HELP,
  LOYALTY_RULE_LABEL,
  LOYALTY_RULE_TYPES,
  TELEMATICS_SCORING,
  loyaltyFormValues,
  normaliseLoyaltyRuleSet,
  type LoyaltyFormValues,
  type LoyaltyRuleType,
} from "@im/core";
import { requireStaff, hasAnyRole } from "@/lib/auth";
import { PERMS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatGHS } from "@/lib/format";
import { ActionForm } from "@/components/ui/forms";
import { Kpi, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { publishFallbackRules } from "./actions";

/** Loyalty rules engine (platform fallback editor + every insurer's published set) and telematics oversight. */
export default function LoyaltyPage() {
  return (
    <>
      <PageHeader
        title="Loyalty & telematics"
        description="Per-insurer reward rules (no-claims, loyalty tiers, bundles, early renewal, safe driver, referral credits) and consented driving scores. Discounts are the insurer's money: Covva records them as explicit lines and never changes a premium."
      />
      <Suspense fallback={<LoadingBlock label="Loading rules…" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const staff = await requireStaff();
  const canWrite = hasAnyRole(staff, PERMS.loyalty);
  const supabase = await createClient();
  const [{ data: sets }, { data: discounts }, { count: enrolments }, { count: withdrawn }, { count: scores }, { count: trips }] = await Promise.all([
    supabase.from("loyalty_rule_sets").select("*, insurer:organizations!loyalty_rule_sets_insurer_org_id_fkey(name)").order("insurer_org_id", { ascending: true, nullsFirst: true }).order("version", { ascending: false }).limit(200),
    supabase.from("quote_discounts").select("id, rule_type, amount, created_at, insurer:organizations!quote_discounts_insurer_org_id_fkey(name)").order("created_at", { ascending: false }).limit(50),
    supabase.from("telematics_enrolments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("telematics_enrolments").select("id", { count: "exact", head: true }).eq("status", "withdrawn"),
    supabase.from("telematics_scores").select("id", { count: "exact", head: true }).eq("final", true),
    supabase.from("telematics_trips").select("id", { count: "exact", head: true }),
  ]);
  const all = sets ?? [];
  const fallback = all.find((s) => s.insurer_org_id === null && s.status === "published") ?? null;
  const values = loyaltyFormValues(fallback ? normaliseLoyaltyRuleSet(fallback) : null);
  const activeTypes = (s: (typeof all)[number]) => normaliseLoyaltyRuleSet(s).rules.filter((r) => r.active).map((r) => LOYALTY_RULE_LABEL[r.type]);
  const byType = new Map<string, number>();
  for (const d of discounts ?? []) byType.set(d.rule_type, (byType.get(d.rule_type) ?? 0) + Number(d.amount));

  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canWrite} />
      <Notice tone="wait">
        The platform fallback applies only to insurers without their own published rules. Every rule in the seeded fallback is switched OFF: insurer-funded discounts need each insurer&apos;s written sign-off (and the NIC position on inducements) before anything is switched on.
      </Notice>

      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Insurers with own rules" value={String(new Set(all.filter((s) => s.insurer_org_id && s.status === "published").map((s) => s.insurer_org_id)).size)} />
        <Kpi label="Active telematics enrolments" value={String(enrolments ?? 0)} hint={`${withdrawn ?? 0} withdrawn`} />
        <Kpi label="Final monthly scores" value={String(scores ?? 0)} hint={`scoring v${TELEMATICS_SCORING.version}`} />
        <Kpi label="Trip summaries stored" value={String(trips ?? 0)} hint="retention: telematics_trips" />
      </div>

      <Panel title={`Platform fallback${fallback ? ` · version ${fallback.version}` : ""}`} description="Publishing creates a new version; the previous one is kept for audit. Field names match the insurer editor in the partner workspace.">
        <FallbackForm values={values} canWrite={canWrite} />
      </Panel>

      <Panel title="Published rule sets" description="Every insurer's current and superseded versions (read-only here: insurers edit their own in the partner workspace).">
        <Table>
          <THead><tr><Th>Scope</Th><Th>Version</Th><Th>Status</Th><Th>Active rules</Th><Th>Max combined</Th><Th>In effect</Th><Th>Published</Th><Th>Note</Th></tr></THead>
          <tbody>
            {all.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium text-ink">{(s.insurer as unknown as { name?: string } | null)?.name ?? "Platform fallback"}</Td>
                <Td>v{s.version}</Td>
                <Td><Pill tone={s.status === "published" ? "ok" : "neutral"}>{s.status}</Pill></Td>
                <Td className="text-xs">{activeTypes(s).join(", ") || "none"}</Td>
                <Td className="tabular-nums">{Number(s.max_combined_pct)}%</Td>
                <Td className="text-xs">{formatDate(s.effective_from)}{s.effective_to ? ` – ${formatDate(s.effective_to)}` : ""}</Td>
                <Td className="text-xs text-muted">{formatDateTime(s.published_at)}</Td>
                <Td className="max-w-xs text-xs text-muted">{s.note ?? "—"}</Td>
              </tr>
            ))}
            {!all.length && <tr><Td colSpan={8} className="py-8 text-center text-muted">No rule sets yet (the migration seeds the platform fallback).</Td></tr>}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Recent discount lines" description="Latest 50 across all insurers. Each line names the rule, the insurer and the amount; the quote's premium is unchanged.">
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted">
          {[...byType.entries()].map(([t, amt]) => <Pill key={t}>{LOYALTY_RULE_LABEL[t as LoyaltyRuleType] ?? t}: {formatGHS(amt, { decimals: true })}</Pill>)}
        </div>
        <Table>
          <THead><tr><Th>When</Th><Th>Insurer</Th><Th>Rule</Th><Th className="text-right">Amount</Th></tr></THead>
          <tbody>
            {(discounts ?? []).map((d) => (
              <tr key={d.id}>
                <Td className="text-xs">{formatDateTime(d.created_at)}</Td>
                <Td>{(d.insurer as unknown as { name?: string } | null)?.name ?? "—"}</Td>
                <Td>{LOYALTY_RULE_LABEL[d.rule_type as LoyaltyRuleType] ?? d.rule_type}</Td>
                <Td className="text-right tabular-nums">−{formatGHS(Number(d.amount), { decimals: true })}</Td>
              </tr>
            ))}
            {!discounts?.length && <tr><Td colSpan={4} className="py-8 text-center text-muted">No discount lines yet.</Td></tr>}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">{LOYALTY_DISCOUNT_NOTE} Telematics: staff see enrolments, scores and trip summaries for support; insurers see monthly scores only; the retention job deletes trip summaries after 13 months (30 days after a withdrawal).</p>
      </Panel>
    </div>
  );
}

/** Same field names as the partner editor (`@im/core` loyaltyRulesFromForm parses both). */
function FallbackForm({ values, canWrite }: { values: LoyaltyFormValues; canWrite: boolean }) {
  const v = (k: string) => values[k] ?? "";
  const num = (type: LoyaltyRuleType, name: string, label: string, min = 0, max = 100, step: string | number = "0.5") => (
    <Field label={label} htmlFor={`${type}_${name}`}><Input id={`${type}_${name}`} name={`${type}_${name}`} type="number" min={min} max={max} step={step} defaultValue={v(`${type}_${name}`)} className="h-10 text-sm" /></Field>
  );
  const tiers = (type: LoyaltyRuleType, label: string, example: string) => (
    <Field label={label} htmlFor={`${type}_tiers`} hint={`e.g. ${example}`} className="sm:col-span-2"><Input id={`${type}_tiers`} name={`${type}_tiers`} defaultValue={v(`${type}_tiers`)} className="h-10 text-sm" /></Field>
  );
  return (
    <ActionForm action={publishFallbackRules} submitLabel="Publish new fallback version" readOnly={!canWrite}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Maximum combined discount (%)" htmlFor="max_combined_pct"><Input id="max_combined_pct" name="max_combined_pct" type="number" min={0} max={100} step="0.5" defaultValue={v("max_combined_pct")} className="h-10 text-sm" /></Field>
        <Field label="In effect from" htmlFor="effective_from"><Input id="effective_from" name="effective_from" type="date" defaultValue={v("effective_from")} className="h-10 text-sm" /></Field>
        <Field label="Until (optional)" htmlFor="effective_to"><Input id="effective_to" name="effective_to" type="date" defaultValue={v("effective_to")} className="h-10 text-sm" /></Field>
      </div>
      {LOYALTY_RULE_TYPES.map((type) => (
        <fieldset key={type} className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{LOYALTY_RULE_LABEL[type]}</legend>
          <p className="mb-3 text-xs text-muted">{LOYALTY_RULE_HELP[type]}</p>
          <div className="mb-3"><Checkbox name={`${type}_active`} defaultChecked={v(`${type}_active`) === "on"} label="Switched on" /></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {type === "no_claims" && <>{tiers(type, "Tiers (years:percent)", "1:10, 2:15, 3:20, 5:25")}{num(type, "max_pct", "Cap (%)")}</>}
            {type === "loyalty_tier" && tiers(type, "Tiers (years:percent (name))", "2:2 (Silver), 4:4 (Gold)")}
            {type === "bundle" && <>{num(type, "pct", "Discount (%)")}{num(type, "min_categories", "Cover types bought together", 2, 10, 1)}</>}
            {type === "early_renewal" && <>{num(type, "pct", "Discount (%)")}{num(type, "days", "Days before the cover ends", 1, 120, 1)}</>}
            {type === "safe_driver" && <>{tiers(type, "Tiers (score:percent)", "75:5, 90:10")}{num(type, "min_months", "Months of scored data needed", 1, 24, 1)}</>}
            {type === "referral_credit" && <>{num(type, "max_pct", "Max share of the premium (%)")}{num(type, "max_amount", "Max amount per policy (GHS)", 0, 1000000, "0.01")}</>}
            <Field label="Starts (optional)" htmlFor={`${type}_from`}><Input id={`${type}_from`} name={`${type}_from`} type="date" defaultValue={v(`${type}_from`)} className="h-10 text-sm" /></Field>
            <Field label="Ends (optional)" htmlFor={`${type}_to`}><Input id={`${type}_to`} name={`${type}_to`} type="date" defaultValue={v(`${type}_to`)} className="h-10 text-sm" /></Field>
          </div>
        </fieldset>
      ))}
      <Field label="Note for the audit trail" htmlFor="note"><Textarea id="note" name="note" rows={2} maxLength={500} className="min-h-16 text-sm" placeholder="Why this version is published (e.g. insurer sign-off reference)" /></Field>
    </ActionForm>
  );
}
