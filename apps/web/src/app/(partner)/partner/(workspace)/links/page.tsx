import type { Metadata } from "next";
import { Suspense } from "react";
import { Field, Input, Notice, PageHeader, Pill, Table, Td, Th, THead } from "@im/ui";
import { formatDate, referralUrl } from "@im/core";
import { can, ROLES } from "../../_lib/context";
import { getDistributorContext } from "../../_lib/distribution";
import { ActionForm } from "@/components/partner/action-form";
import { CopyField } from "@/components/referrals/copy-field";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";
import { siteUrl } from "@/server/api-auth";
import { createCampaignLink, toggleLink } from "./actions";

export const metadata: Metadata = { title: "Referral links" };

export default function LinksPage() {
  return (
    <>
      <PageHeader title="Referral links" description="Campaign links for showrooms, emails, QR codes and social posts. Anyone who opens one is attributed to you for 30 days." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Links />
      </Suspense>
    </>
  );
}

async function Links() {
  const { ctx, partner, links } = await getDistributorContext();
  if (!partner) return <Notice tone="info">Your distribution partnership is being set up by Covva.</Notice>;
  const canEdit = can(ctx, ROLES.orgAdmin);
  const base = siteUrl();
  return (
    <div className="space-y-6">
      {canEdit && (
        <Section title="New campaign link">
          <ActionForm action={createCampaignLink} submitLabel="Create link" resetOnSuccess className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" footerClassName="sm:pb-0.5">
            <Field label="Campaign" htmlFor="l-campaign"><Input id="l-campaign" name="campaign" required maxLength={80} placeholder="Showroom QR — Spintex" className="h-10 text-sm" /></Field>
            <Field label="Opens" htmlFor="l-landing" hint="A page on Covva, e.g. /insurance/motor"><Input id="l-landing" name="landing" placeholder="/insurance/motor" className="h-10 text-sm" /></Field>
          </ActionForm>
        </Section>
      )}
      <Section title="Your links" description="The first link is also your widget code.">
        {links.length === 0 ? (
          <Empty>No links yet.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Campaign</Th><Th>Link</Th><Th>Created</Th><Th>Status</Th><Th /></tr></THead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium text-ink">{l.campaign ?? "—"}<p className="font-mono text-xs text-muted">{l.code}</p></Td>
                  <Td className="min-w-[280px]"><CopyField label={`Link ${l.code}`} value={referralUrl(l.code, l.landing_path, base)} /></Td>
                  <Td className="text-xs">{formatDate(l.created_at)}</Td>
                  <Td>{l.disabled_at ? <Pill>Disabled</Pill> : <Pill tone="ok">Active</Pill>}</Td>
                  <Td>
                    {canEdit && (
                      <ActionForm action={toggleLink} submitLabel={l.disabled_at ? "Enable" : "Disable"} variant="ghost" inline confirm={l.disabled_at ? undefined : "Disable this link? New visitors will no longer be attributed to it."}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="op" value={l.disabled_at ? "enable" : "disable"} />
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
