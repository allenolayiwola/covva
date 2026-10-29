import { Suspense } from "react";
import { Notice } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { leadKindToAccountKind } from "@im/core";
import { requireCrm, staffDirectory } from "@/lib/crm";
import { isUuid, orgMap, sp, type SearchParams } from "@/lib/query";
import { Breadcrumb, LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { AccountFields } from "../AccountFields";
import { createAccount } from "../actions";
import { CRM_BASE } from "../meta";

export default function NewAccountPage({ searchParams }: PageProps<"/partners/crm/new">) {
  return (
    <>
      <Breadcrumb items={[{ label: "Partnerships CRM", href: CRM_BASE }, { label: "New account" }]} />
      <PageHeader title="New account" description="Record a prospect you sourced yourself, from a referral or an event. Website and broker-suggested leads arrive in the pipeline automatically." />
      <Suspense fallback={<LoadingBlock />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Form({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, supabase } = await requireCrm();
  const params = await searchParams;
  const leadId = sp(params, "lead");
  const [staff, orgs, lead] = await Promise.all([
    staffDirectory(supabase, actor.staff.orgId),
    orgMap(supabase),
    isUuid(leadId) ? supabase.from("leads").select("id, kind, name, email, phone, organization, utm").eq("id", leadId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const tags = lead ? (((lead.utm as Record<string, unknown> | null)?.tags as string[] | undefined) ?? []) : [];
  const defaults = lead
    ? {
        kind: leadKindToAccountKind(lead.kind, tags) ?? "insurer",
        name: lead.organization ?? lead.name,
        source: "website_form",
        contact_name: lead.name,
        contact_email: lead.email ?? "",
        contact_phone: lead.phone ?? "",
      }
    : undefined;

  if (!actor.canWrite) {
    return <Notice tone="info">Your role is read-only in the CRM. Ask a partnerships lead to add the account.</Notice>;
  }
  return (
    <Panel className="max-w-4xl">
      <ActionForm action={createAccount} submitLabel="Create account">
        {lead && <input type="hidden" name="lead_id" value={lead.id} />}
        <AccountFields staff={staff} orgs={[...orgs.values()]} defaults={defaults} />
        <Notice tone="info">The account starts at “Lead”. {actor.isRep ? "It is assigned to you unless you pick another owner." : "Pick an owner so the rep is notified."}</Notice>
      </ActionForm>
    </Panel>
  );
}
