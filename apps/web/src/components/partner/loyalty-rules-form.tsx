import { LOYALTY_RULE_HELP, LOYALTY_RULE_LABEL, LOYALTY_RULE_TYPES, type LoyaltyFormValues, type LoyaltyRuleType } from "@im/core";
import { Checkbox, Field, Input, Textarea } from "@im/ui";
import { ActionForm, type FormAction } from "./action-form";

/**
 * Structured editor for a loyalty rule set (one rule per type). Submitting publishes a NEW VERSION through
 * public.publish_loyalty_rule_set(); nothing is edited in place. Shared by the insurer workspace; the admin
 * console has its own copy of the same field names (`@im/core` loyaltyRulesFromForm parses both).
 */
export function LoyaltyRulesForm({ action, values, submitLabel = "Publish new version", readOnly = false }: { action: FormAction; values: LoyaltyFormValues; submitLabel?: string; readOnly?: boolean }) {
  const v = (k: string) => values[k] ?? "";
  const section = (type: LoyaltyRuleType, fields: React.ReactNode) => (
    <fieldset key={type} className="rounded-xl border border-line p-4" disabled={readOnly}>
      <legend className="px-1 text-sm font-semibold text-ink">{LOYALTY_RULE_LABEL[type]}</legend>
      <p className="mb-3 text-[13px] text-muted">{LOYALTY_RULE_HELP[type]}</p>
      <div className="mb-3"><Checkbox name={`${type}_active`} defaultChecked={v(`${type}_active`) === "on"} label="Switched on" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields}
        <Field label="Starts (optional)" htmlFor={`${type}_from`}><Input id={`${type}_from`} name={`${type}_from`} type="date" defaultValue={v(`${type}_from`)} className="h-10 text-sm" /></Field>
        <Field label="Ends (optional)" htmlFor={`${type}_to`}><Input id={`${type}_to`} name={`${type}_to`} type="date" defaultValue={v(`${type}_to`)} className="h-10 text-sm" /></Field>
      </div>
    </fieldset>
  );
  const tiers = (type: LoyaltyRuleType, by: "years" | "score", example: string) => (
    <Field label={by === "years" ? "Tiers (years:percent, comma-separated)" : "Tiers (score:percent, comma-separated)"} htmlFor={`${type}_tiers`} hint={`e.g. ${example}`} className="sm:col-span-2">
      <Input id={`${type}_tiers`} name={`${type}_tiers`} defaultValue={v(`${type}_tiers`)} className="h-10 text-sm" />
    </Field>
  );
  const pct = (type: LoyaltyRuleType, name: string, label: string) => (
    <Field label={label} htmlFor={`${type}_${name}`}><Input id={`${type}_${name}`} name={`${type}_${name}`} type="number" min={0} max={100} step="0.5" defaultValue={v(`${type}_${name}`)} className="h-10 text-sm" /></Field>
  );

  return (
    <ActionForm action={action} submitLabel={submitLabel} className="space-y-4" hideSubmit={readOnly}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Maximum combined discount (%)" htmlFor="max_combined_pct" hint="Percentage rules together never exceed this; referral credits are outside it.">
          <Input id="max_combined_pct" name="max_combined_pct" type="number" min={0} max={100} step="0.5" defaultValue={v("max_combined_pct")} className="h-10 text-sm" disabled={readOnly} />
        </Field>
        <Field label="Rule set in effect from" htmlFor="effective_from"><Input id="effective_from" name="effective_from" type="date" defaultValue={v("effective_from")} className="h-10 text-sm" disabled={readOnly} /></Field>
        <Field label="Until (optional)" htmlFor="effective_to"><Input id="effective_to" name="effective_to" type="date" defaultValue={v("effective_to")} className="h-10 text-sm" disabled={readOnly} /></Field>
      </div>
      {LOYALTY_RULE_TYPES.map((type) => {
        switch (type) {
          case "no_claims":
            return section(type, <>{tiers(type, "years", "1:10, 2:15, 3:20, 5:25")}{pct(type, "max_pct", "Cap (%)")}</>);
          case "loyalty_tier":
            return section(type, tiers(type, "years", "2:2 (Silver), 4:4 (Gold)"));
          case "bundle":
            return section(type, <>{pct(type, "pct", "Discount (%)")}<Field label="Cover types bought together" htmlFor="bundle_min_categories"><Input id="bundle_min_categories" name="bundle_min_categories" type="number" min={2} max={10} defaultValue={v("bundle_min_categories")} className="h-10 text-sm" /></Field></>);
          case "early_renewal":
            return section(type, <>{pct(type, "pct", "Discount (%)")}<Field label="Days before the cover ends" htmlFor="early_renewal_days"><Input id="early_renewal_days" name="early_renewal_days" type="number" min={1} max={120} defaultValue={v("early_renewal_days")} className="h-10 text-sm" /></Field></>);
          case "safe_driver":
            return section(type, <>{tiers(type, "score", "75:5, 90:10")}<Field label="Months of scored data needed" htmlFor="safe_driver_min_months"><Input id="safe_driver_min_months" name="safe_driver_min_months" type="number" min={1} max={24} defaultValue={v("safe_driver_min_months")} className="h-10 text-sm" /></Field></>);
          case "referral_credit":
            return section(type, <>{pct(type, "max_pct", "Max share of the premium (%)")}<Field label="Max amount per policy (GHS, optional)" htmlFor="referral_credit_max_amount"><Input id="referral_credit_max_amount" name="referral_credit_max_amount" type="number" min={0} step="0.01" defaultValue={v("referral_credit_max_amount")} className="h-10 text-sm" /></Field></>);
        }
      })}
      <Field label="Note for the audit trail" htmlFor="note" hint="Why this version was published (shown in the version history).">
        <Textarea id="note" name="note" rows={2} maxLength={500} className="min-h-16 text-sm" disabled={readOnly} />
      </Field>
    </ActionForm>
  );
}
