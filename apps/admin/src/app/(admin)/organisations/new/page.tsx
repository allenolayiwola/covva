import { Suspense } from "react";
import { Field, Select, Checkbox, Notice } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { PERMS } from "@/lib/roles";
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
  await requireStaff(PERMS.network);
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
        <Notice tone="info">Fields that don&apos;t apply to the chosen type (e.g. Paystack subaccount for non-insurers) are ignored.</Notice>
      </ActionForm>
    </Panel>
  );
}
