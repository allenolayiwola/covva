import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, Notice, PageHeader, buttonClass } from "@im/ui";
import { CLIENT_IMPORT_TEMPLATE } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getTeam } from "../../../_lib/data";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { importClients } from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import clients" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import existing clients"
        description="Bring your book onto Covva. Imported clients stay with you for renewals and servicing (assisted service), and their current policies are recorded for renewal reminders."
        actions={<Link href="/partner/customers" className={buttonClass("outline", "sm")}>Back to customers</Link>}
      />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Import />
      </Suspense>
    </>
  );
}

async function Import() {
  const ctx = await requireKind("broker");
  if (!can(ctx, ROLES.orgAdmin)) {
    return <Notice tone="info">Only owners and admins can import clients. Ask an organisation admin to run the import.</Notice>;
  }
  const team = await getTeam(ctx);
  const managers = team.filter((m) => m.active && ["owner", "admin", "supervisor", "adviser"].includes(m.role)).map((m) => ({ id: m.userId, name: m.name }));
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(CLIENT_IMPORT_TEMPLATE)}`;
  return (
    <div className="space-y-6">
      <Notice tone="info" title="Before you import">
        <ul className="list-disc space-y-1 pl-5">
          <li>You confirm each client agreed to be onboarded onto Covva by your organisation (Data Protection Act, 2012).</li>
          <li>Clients already on Covva with another broker are skipped — they choose their broker themselves.</li>
          <li>Policies bought elsewhere are recorded as external policies; the insurer name is matched to insurers on Covva where possible.</li>
        </ul>
        <a href={template} download="covva-client-import-template.csv" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Download the CSV template</a>
      </Notice>
      <Section title="Upload your client list" description="Check the file first: invalid rows are listed with their line numbers and are never partially imported.">
        <ImportForm action={importClients} managers={managers} />
      </Section>
      {ctx.isDemo && <DemoBadge />}
    </div>
  );
}
