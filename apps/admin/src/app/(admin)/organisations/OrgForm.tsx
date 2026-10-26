import type { Row } from "@im/db";
import { Field, Input, Select, Textarea } from "@im/ui";
import { GHANA_REGIONS } from "@im/core";
import { INTEGRATION_LEVELS } from "@/lib/org-meta";

type Org = Partial<Row<"organizations">>;

/** Shared organisation fields (create + edit). Plain inputs; validation happens in the Server Action. */
export function OrgFields({ org, type }: { org?: Org; type?: string }) {
  const t = type ?? org?.type;
  return (
    <div className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Identity</legend>
        <Field label="Display name" htmlFor="name"><Input id="name" name="name" required defaultValue={org?.name ?? ""} /></Field>
        <Field label="Legal name" htmlFor="legal_name"><Input id="legal_name" name="legal_name" defaultValue={org?.legal_name ?? ""} /></Field>
        <Field label="Company registration number" htmlFor="registration_number"><Input id="registration_number" name="registration_number" defaultValue={org?.registration_number ?? ""} /></Field>
        <Field label="Region" htmlFor="region">
          <Select id="region" name="region" defaultValue={org?.region ?? ""}>
            <option value="">—</option>
            {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={org?.description ?? ""} className="min-h-20" /></Field>
      </fieldset>

      {t !== "enterprise" && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Regulatory</legend>
          <Field label="NIC licence number" htmlFor="nic_licence_number" hint="Changing it clears the verification."><Input id="nic_licence_number" name="nic_licence_number" defaultValue={org?.nic_licence_number ?? ""} /></Field>
          <Field label="NIC licence class" htmlFor="nic_licence_class"><Input id="nic_licence_class" name="nic_licence_class" placeholder="Insurance broker / Non-life / Life" defaultValue={org?.nic_licence_class ?? ""} /></Field>
          <Field label="Licence expires on" htmlFor="nic_licence_expires_on"><Input id="nic_licence_expires_on" name="nic_licence_expires_on" type="date" defaultValue={org?.nic_licence_expires_on ?? ""} /></Field>
          {t === "broker" || !t ? (
            <Field label="Professional indemnity expires on" htmlFor="professional_indemnity_expires_on" hint="Brokers only"><Input id="professional_indemnity_expires_on" name="professional_indemnity_expires_on" type="date" defaultValue={org?.professional_indemnity_expires_on ?? ""} /></Field>
          ) : <input type="hidden" name="professional_indemnity_expires_on" value={org?.professional_indemnity_expires_on ?? ""} />}
        </fieldset>
      )}

      {(t === "insurer" || !t) && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Insurer integration</legend>
          <Field label="Paystack subaccount code" htmlFor="paystack_subaccount_code" hint="Premiums settle directly to this insurer subaccount (ACCT_…). Insurers only.">
            <Input id="paystack_subaccount_code" name="paystack_subaccount_code" defaultValue={org?.paystack_subaccount_code ?? ""} placeholder="ACCT_xxxxxxxx" />
          </Field>
          <Field label="Integration level" htmlFor="integration_level">
            <Select id="integration_level" name="integration_level" defaultValue={org?.integration_level ?? ""}>
              <option value="">Not set</option>
              {INTEGRATION_LEVELS.map((l) => <option key={l} value={l}>{l.replace("_", " ")}</option>)}
            </Select>
          </Field>
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Contact & brand</legend>
        <Field label="Contact email" htmlFor="contact_email"><Input id="contact_email" name="contact_email" type="email" defaultValue={org?.contact_email ?? ""} /></Field>
        <Field label="Contact phone" htmlFor="contact_phone"><Input id="contact_phone" name="contact_phone" defaultValue={org?.contact_phone ?? ""} /></Field>
        <Field label="Website" htmlFor="website"><Input id="website" name="website" type="url" defaultValue={org?.website ?? ""} /></Field>
        <Field label="Address" htmlFor="address"><Input id="address" name="address" defaultValue={org?.address ?? ""} /></Field>
        <Field label="Brand colour" htmlFor="brand_color" hint="Hex, e.g. #00796E">
          <div className="flex items-center gap-2">
            <Input id="brand_color" name="brand_color" defaultValue={org?.brand_color ?? ""} pattern="#[0-9a-fA-F]{6}" placeholder="#00796E" />
            {org?.brand_color && <span className="size-9 shrink-0 rounded-lg border border-line" style={{ background: org.brand_color }} aria-hidden />}
          </div>
        </Field>
        <Field label="Logo URL" htmlFor="logo_url"><Input id="logo_url" name="logo_url" type="url" defaultValue={org?.logo_url ?? ""} /></Field>
      </fieldset>
    </div>
  );
}
