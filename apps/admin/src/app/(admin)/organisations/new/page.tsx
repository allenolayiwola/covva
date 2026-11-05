import { Suspense } from "react";
import { Field, Input, Select, Checkbox, Notice } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can, PERMS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { commercialDefaults } from "@/lib/commercial";
import { Breadcrumb, LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { OrgFields } from "../OrgForm";
import { createOrganisation } from "../actions";

export default function NewOrganisationPage() {
  return (
    <>
      <Breadcrumb items={[{ label: "Organisations", href: "/organisations" }, { label: "New" }]} />
      <PageHeader title="New organisation" description="New partners start as pending. Verify the NIC licence and complete due diligence before activating." />
      <Suspense fallback={<LoadingBlock />}>
        <Form />
      </Suspense>
    </>
  );
}

async function Form() {
  const staff = await requireStaff(PERMS.network);
  const defaults = await commercialDefaults(await createClient());
  const mayCustomise = can(staff.roles, "commercial");
  return (
    <Panel className="max-w-4xl">
      <ActionForm action={createOrganisation} submitLabel="Create organisation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="type">
            <Select id="type" name="type" required defaultValue="broker">
              <option value="broker">Broker</option>
              <option value="insurer">Insurer</option>
              <option value="enterprise">Enterprise (employer / affinity)</option>
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox name="demo" label="Demo / fictional organisation (settings.demo)" />
          </div>
        </div>
        <OrgFields />
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Commercial terms (insurers)</legend>
          <Field
            label="Platform fee %"
            htmlFor="platform_fee_pct"
            hint={mayCustomise ? "Of each premium, paid to Covva through the Paystack split. The insurer's subaccount percentage charge must match." : "Only a platform admin can change this; the platform default applies."}
          >
            <Input id="platform_fee_pct" name="platform_fee_pct" type="number" step="0.01" min={0} max={100} defaultValue={defaults.platformFeePct} readOnly={!mayCustomise} />
          </Field>
          <Field label="Standard broker commission %" htmlFor="broker_commission_pct" hint="Paid to brokers who place this insurer's business.">
            <Input id="broker_commission_pct" name="broker_commission_pct" type="number" step="0.01" min={0} max={100} defaultValue={0} readOnly={!mayCustomise} />
          </Field>
          <p className="text-xs text-muted sm:col-span-2">Brokers start on the default {defaults.revenueSharePct}% revenue share. Defaults are set under Commercial terms; change any partner&apos;s terms later on its page.</p>
        </fieldset>
        <Notice tone="info">Fields that don&apos;t apply to the chosen type (e.g. Paystack subaccount for non-insurers) are ignored.</Notice>
      </ActionForm>
    </Panel>
  );
}
