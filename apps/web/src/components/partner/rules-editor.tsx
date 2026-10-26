"use client";
import { useState } from "react";
import { Checkbox, Field, Input, Pill, Select, cn } from "@im/ui";
import { RULE_OPS, RULE_OUTCOMES, type RiskField, type RuleOp, type UnderwritingRule } from "@im/core";
import { ActionForm, type FormAction } from "./action-form";

const NO_VALUE: RuleOp[] = ["exists", "missing"];
const tone = (o: string) => (o === "accept" ? "ok" : o === "refer" ? "wait" : "danger") as "ok" | "wait" | "danger";

function flat(c: UnderwritingRule["condition"] | undefined): { field: string; op: RuleOp; value: string } {
  if (c && "field" in c) {
    const v = c.value;
    return { field: c.field, op: c.op, value: Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v) };
  }
  return { field: "", op: "eq", value: "" };
}

/** One rule as a form row: field, operator, value, outcome, message. */
export function RuleForm({ action, versionId, fields, rule, compact }: { action: FormAction; versionId: string; fields: RiskField[]; rule?: UnderwritingRule; compact?: boolean }) {
  const init = flat(rule?.condition);
  const [op, setOp] = useState<RuleOp>(init.op);
  const [outcome, setOutcome] = useState(rule?.outcome ?? "refer");
  const known = fields.some((f) => f.key === init.field);
  return (
    <ActionForm action={action} submitLabel={rule ? "Update" : "Add rule"} className={cn("rounded-lg border border-line p-3", compact && "bg-white")} resetOnSuccess={!rule}>
      <input type="hidden" name="versionId" value={versionId} />
      {rule?.id && <input type="hidden" name="ruleId" value={rule.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Rule name" htmlFor={`rn-${rule?.id ?? "new"}`}><Input id={`rn-${rule?.id ?? "new"}`} name="name" defaultValue={rule?.name ?? ""} required placeholder="Vehicle over 15 years" className="h-10 text-sm" /></Field>
        <Field label="Field" htmlFor={`rf-${rule?.id ?? "new"}`}>
          <Select id={`rf-${rule?.id ?? "new"}`} name="field" defaultValue={init.field} required className="h-10 text-sm">
            <option value="">Choose a risk field…</option>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
            {init.field && !known && <option value={init.field}>{init.field}</option>}
          </Select>
        </Field>
        <Field label="Operator" htmlFor={`ro-${rule?.id ?? "new"}`}>
          <Select id={`ro-${rule?.id ?? "new"}`} name="op" value={op} onChange={(e) => setOp(e.currentTarget.value as RuleOp)} className="h-10 text-sm">
            {RULE_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Value" htmlFor={`rv-${rule?.id ?? "new"}`} hint={op === "in" || op === "not_in" ? "Comma-separated list" : undefined}>
          <Input id={`rv-${rule?.id ?? "new"}`} name="value" defaultValue={init.value} disabled={NO_VALUE.includes(op)} placeholder={NO_VALUE.includes(op) ? "—" : "15"} className="h-10 text-sm" />
        </Field>
        <Field label="Outcome" htmlFor={`rout-${rule?.id ?? "new"}`}>
          <Select id={`rout-${rule?.id ?? "new"}`} name="outcome" value={outcome} onChange={(e) => setOutcome(e.currentTarget.value as typeof outcome)} className="h-10 text-sm">
            {RULE_OUTCOMES.map((o) => <option key={o} value={o}>{o === "refer" ? "Refer to insurer review" : o === "accept" ? "Accept" : "Decline"}</option>)}
          </Select>
        </Field>
        <Field label="Message (shown to broker / insurer)" htmlFor={`rm-${rule?.id ?? "new"}`} className="sm:col-span-2">
          <Input id={`rm-${rule?.id ?? "new"}`} name="message" defaultValue={rule?.message ?? ""} placeholder="Vehicles older than 15 years need underwriter review." className="h-10 text-sm" />
        </Field>
        <Field label="Priority (low runs first)" htmlFor={`rp-${rule?.id ?? "new"}`}><Input id={`rp-${rule?.id ?? "new"}`} name="priority" type="number" min={0} max={10000} defaultValue={rule?.priority ?? 100} className="h-10 text-sm" /></Field>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox name="active" label="Active" defaultChecked={rule ? rule.active !== false : true} />
        <Pill tone={tone(outcome)}>{outcome}</Pill>
      </div>
    </ActionForm>
  );
}
