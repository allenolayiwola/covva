import { AUDIENCE_LABEL, AUDIENCE_TAGS, INSTALMENT_PLAN_KEYS, INSTALMENT_PLAN_LABEL, PERIOD_LABEL, POLICY_PERIODS, parseInstalmentPlans, planRulesText } from "@im/core";
import type { Json } from "@im/db";
import { Checkbox, Field, Input } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { setVersionPlans } from "@/app/(partner)/partner/(workspace)/products/plan-actions";

/** Insurer version editor: periods, instalment plans, micro flag and audience tags (Phase 3). */
export function VersionPlansForm({ version, editable }: { version: { id: string; status: string; periods: string[]; instalment_plans: Json; micro: boolean; audience_tags: string[] }; editable: boolean }) {
  const plans = parseInstalmentPlans(version.instalment_plans);
  const canEdit = editable && version.status === "draft";
  if (!canEdit) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink">Periods: {version.periods.map((p) => PERIOD_LABEL[p as keyof typeof PERIOD_LABEL]?.noun ?? p).join(", ")}{version.micro ? " · micro product" : ""}</p>
        {version.audience_tags.length > 0 && <p className="text-muted">For: {version.audience_tags.map((t) => AUDIENCE_LABEL[t as keyof typeof AUDIENCE_LABEL] ?? t).join(", ")}</p>}
        {plans.length ? plans.map((p) => <div key={p.key}><p className="font-medium text-ink">{INSTALMENT_PLAN_LABEL[p.key]}</p><ul className="text-xs text-muted">{planRulesText(p).map((t) => <li key={t}>• {t}</li>)}</ul></div>) : <p className="text-muted">No instalment plans (paid in full).</p>}
        {editable && version.status !== "draft" && <p className="text-xs text-subtle">Change these on a draft version (schedule a price change).</p>}
      </div>
    );
  }
  return (
    <ActionForm action={setVersionPlans} submitLabel="Save periods and plans" className="space-y-4">
      <input type="hidden" name="versionId" value={version.id} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Policy periods</legend>
        <div className="flex flex-wrap gap-3">
          {POLICY_PERIODS.map((p) => <Checkbox key={p} name="periods" value={p} defaultChecked={version.periods.includes(p)} label={<span className="text-sm">{PERIOD_LABEL[p].noun}</span>} />)}
        </div>
        <p className="mt-1 text-xs text-muted">Short periods price from <code>period_factors</code> in the rating rule, or pro rata with a minimum premium.</p>
      </fieldset>
      <Checkbox name="micro" defaultChecked={version.micro} label={<span className="text-sm">Micro / on-demand product (daily, weekly or monthly, pay as you go)</span>} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Who it is for</legend>
        <div className="flex flex-wrap gap-3">
          {AUDIENCE_TAGS.map((t) => <Checkbox key={t} name="audience" value={t} defaultChecked={version.audience_tags.includes(t)} label={<span className="text-sm">{AUDIENCE_LABEL[t]}</span>} />)}
        </div>
      </fieldset>
      {INSTALMENT_PLAN_KEYS.map((key) => {
        const p = plans.find((x) => x.key === key);
        return (
          <fieldset key={key} className="rounded-card border border-line p-3">
            <legend className="px-1 text-sm font-medium text-ink-2">{INSTALMENT_PLAN_LABEL[key]} instalments</legend>
            <Checkbox name={`${key}_on`} defaultChecked={!!p} label={<span className="text-sm">Offer this plan</span>} />
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Payments" htmlFor={`${key}_count`}><Input id={`${key}_count`} name={`${key}_count`} type="number" min={2} max={24} defaultValue={p?.count ?? (key === "monthly" ? 12 : 4)} className="h-9 text-sm" /></Field>
              <Field label="Deposit %" htmlFor={`${key}_dep`}><Input id={`${key}_dep`} name={`${key}_deposit_pct`} type="number" step="0.01" min={0} max={100} defaultValue={p?.deposit_pct ?? 0} className="h-9 text-sm" /></Field>
              <Field label="Surcharge %" htmlFor={`${key}_sur`}><Input id={`${key}_sur`} name={`${key}_surcharge_pct`} type="number" step="0.01" min={0} max={100} defaultValue={p?.surcharge_pct ?? 0} className="h-9 text-sm" /></Field>
              <Field label="Grace days" htmlFor={`${key}_gr`}><Input id={`${key}_gr`} name={`${key}_grace_days`} type="number" min={0} max={90} defaultValue={p?.grace_days ?? 14} className="h-9 text-sm" /></Field>
              <Field label="Lapse after (days)" htmlFor={`${key}_la`}><Input id={`${key}_la`} name={`${key}_lapse_after_days`} type="number" min={0} max={180} defaultValue={p?.lapse_after_days ?? 30} className="h-9 text-sm" /></Field>
              <Field label="Reinstate within (days)" htmlFor={`${key}_wd`}><Input id={`${key}_wd`} name={`${key}_within_days`} type="number" min={0} max={365} defaultValue={p?.reinstatement.within_days ?? 60} className="h-9 text-sm" /></Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-4">
              <Checkbox name={`${key}_rein_on`} defaultChecked={p?.reinstatement.allowed ?? true} label={<span className="text-sm">Reinstatement allowed</span>} />
              <Checkbox name={`${key}_rein_review`} defaultChecked={p?.reinstatement.requires_review ?? true} label={<span className="text-sm">Reinstatement needs our review</span>} />
            </div>
          </fieldset>
        );
      })}
    </ActionForm>
  );
}
