import { Field, Input, Select } from "@im/ui";
import { CRM_ACCOUNT_KINDS, CRM_SOURCES } from "@im/core";
import type { CrmAccount, StaffMember } from "@/lib/crm";
import { contactOf } from "@/lib/crm";
import type { OrgLite } from "@/lib/query";
import { KIND_LABEL, SOURCE_LABEL } from "./meta";

/**
 * Shared account fields for the create and edit forms (server-renderable; no hooks).
 * Inputs are 44px tall (`h-11`) so they work as tap targets in the field.
 */
export function AccountFields({
  account,
  staff,
  orgs,
  defaults,
}: {
  account?: CrmAccount | null;
  staff: StaffMember[];
  orgs: OrgLite[];
  defaults?: Partial<{ kind: string; name: string; source: string; contact_name: string; contact_email: string; contact_phone: string; region: string }>;
}) {
  const c = account ? contactOf(account) : {};
  const kind = account?.kind ?? defaults?.kind ?? "insurer";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="crm-name" className="sm:col-span-2">
        <Input id="crm-name" name="name" required minLength={2} maxLength={200} defaultValue={account?.name ?? defaults?.name ?? ""} placeholder="Company or scheme name" />
      </Field>
      <Field label="Kind" htmlFor="crm-kind">
        <Select id="crm-kind" name="kind" required defaultValue={kind}>
          {CRM_ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
      </Field>
      <Field label="Source" htmlFor="crm-source">
        <Select id="crm-source" name="source" defaultValue={account?.source ?? defaults?.source ?? "rep"}>
          {CRM_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Owner (rep)" htmlFor="crm-owner" hint="Partnerships team members are listed first.">
        <Select id="crm-owner" name="owner_user_id" defaultValue={account?.owner_user_id ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}{m.team === "partnerships" ? (m.isSupervisor ? " · partnerships lead" : " · partnerships") : ""}</option>
          ))}
        </Select>
      </Field>
      <Field label="Linked organisation" htmlFor="crm-org" hint="Required before the account can go live.">
        <Select id="crm-org" name="org_id" defaultValue={account?.org_id ?? ""}>
          <option value="">Not on the platform yet</option>
          {orgs.filter((o) => o.type !== "platform").map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type}, {o.status})</option>)}
        </Select>
      </Field>
      <Field label="Region" htmlFor="crm-region">
        <Input id="crm-region" name="region" maxLength={100} defaultValue={account?.region ?? defaults?.region ?? ""} placeholder="Greater Accra" />
      </Field>
      <Field label="Estimated annual value (GHS)" htmlFor="crm-value">
        <Input id="crm-value" name="estimated_value" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={account?.estimated_value ?? ""} />
      </Field>
      <Field label="Expected go-live" htmlFor="crm-golive">
        <Input id="crm-golive" name="expected_go_live" type="date" defaultValue={account?.expected_go_live ?? ""} />
      </Field>
      <Field label="Tags" htmlFor="crm-tags" hint="Comma separated, e.g. motor, group, priority">
        <Input id="crm-tags" name="tags" maxLength={500} defaultValue={(account?.tags ?? []).join(", ")} />
      </Field>
      <fieldset className="contents">
        <Field label="Contact name" htmlFor="crm-cname">
          <Input id="crm-cname" name="contact_name" maxLength={200} defaultValue={c.name ?? defaults?.contact_name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Contact title" htmlFor="crm-ctitle">
          <Input id="crm-ctitle" name="contact_title" maxLength={100} defaultValue={c.title ?? ""} placeholder="Head of Partnerships" />
        </Field>
        <Field label="Contact email" htmlFor="crm-cemail" hint="Assisted onboarding invitations are sent here.">
          <Input id="crm-cemail" name="contact_email" type="email" inputMode="email" maxLength={200} defaultValue={c.email ?? defaults?.contact_email ?? ""} autoComplete="off" />
        </Field>
        <Field label="Contact phone" htmlFor="crm-cphone">
          <Input id="crm-cphone" name="contact_phone" type="tel" inputMode="tel" maxLength={50} defaultValue={c.phone ?? defaults?.contact_phone ?? ""} autoComplete="off" />
        </Field>
      </fieldset>
    </div>
  );
}
