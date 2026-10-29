import { Suspense } from "react";
import { Field, Input, Notice, Pill, Select, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { EMBED_DISCLOSURE, PARTNER_SEGMENTS, PARTNER_SEGMENT_LABEL } from "@im/core";
import { requireStaff, hasAnyRole } from "@/lib/auth";
import { PERMS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { ActionForm } from "@/components/ui/forms";
import { LoadingBlock, Panel } from "@/components/ui/layout";
import { createDistributionPartner, updateDistributionPartner } from "./actions";

const TONE = { pending: "wait", active: "ok", suspended: "danger" } as const;

/** Embedded distribution partners (Phase 3): dealers, banks, landlords, fleets, travel agents, remittance providers, employers. */
export default function DistributionPage() {
  return (
    <>
      <PageHeader
        title="Distribution partners"
        description="Partners who offer Covva quotes at their point of sale through the widget or partner API. They introduce customers only — no advice, binding or money. Revenue share is a share of Covva's platform fee, never of the premium."
      />
      <Suspense fallback={<LoadingBlock label="Loading partners…" />}>
        <Partners />
      </Suspense>
    </>
  );
}

async function Partners() {
  const staff = await requireStaff();
  const canWrite = hasAnyRole(staff, PERMS.distribution);
  const supabase = await createClient();
  const [{ data: partners }, { data: categories }, { data: accounts }, { data: orgs }, { data: links }] = await Promise.all([
    supabase.from("distribution_partners").select("*, org:organizations!distribution_partners_org_id_fkey(id, name, slug, status)").order("created_at", { ascending: false }),
    supabase.from("product_categories").select("slug, name, availability").order("sort_order"),
    supabase.from("crm_accounts").select("id, name, org_id, stage").eq("kind", "embedded_partner").order("name"),
    supabase.from("organizations").select("id, name").eq("type", "distributor").order("name"),
    supabase.from("referral_links").select("owner_org_id, code, disabled_at").eq("owner_kind", "distributor").order("created_at"),
  ]);
  const cats = (categories ?? []).filter((c) => c.availability !== "planned");
  const taken = new Set((partners ?? []).map((p) => p.org_id));
  const codeFor = (orgId: string) => (links ?? []).find((l) => l.owner_org_id === orgId && !l.disabled_at)?.code ?? null;

  return (
    <div className="space-y-6">
      <Notice tone="info">Every embedded surface shows: “{EMBED_DISCLOSURE}” Comparison order is by price only; partners and paid placements never change it.</Notice>
      <Panel title="Partners" description={`${partners?.length ?? 0} partner${partners?.length === 1 ? "" : "s"}`}>
        <Table>
          <THead><tr><Th>Partner</Th><Th>Segment</Th><Th>Categories</Th><Th>Widget domains</Th><Th>Revenue share</Th><Th>Status</Th><Th>Code</Th></tr></THead>
          <tbody>
            {(partners ?? []).map((p) => {
              const org = p.org as unknown as { name: string; slug: string; status: string } | null;
              return (
                <tr key={p.id}>
                  <Td><p className="font-medium text-ink">{org?.name ?? "—"}</p><p className="text-xs text-muted">{org?.slug} · org {org?.status} · since {formatDate(p.created_at)}</p></Td>
                  <Td>{PARTNER_SEGMENT_LABEL[p.segment as keyof typeof PARTNER_SEGMENT_LABEL] ?? p.segment}</Td>
                  <Td className="text-xs">{p.allowed_categories.length ? p.allowed_categories.join(", ") : "All available"}</Td>
                  <Td className="text-xs">{p.widget_domains.length ? p.widget_domains.join(" ") : <span className="text-muted">none — cannot be framed</span>}</Td>
                  <Td className="tabular-nums">{Number(p.revenue_share_pct)}% of fee</Td>
                  <Td><Pill tone={TONE[p.status as keyof typeof TONE] ?? "neutral"}>{p.status}</Pill></Td>
                  <Td className="font-mono text-xs">{codeFor(p.org_id) ?? "—"}</Td>
                </tr>
              );
            })}
            {!partners?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No distribution partners yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>

      {(partners ?? []).map((p) => {
        const org = p.org as unknown as { name: string } | null;
        return (
          <Panel key={p.id} title={`Edit · ${org?.name ?? p.org_id}`}>
            <ActionForm action={updateDistributionPartner} readOnly={!canWrite} submitLabel="Save partner">
              <input type="hidden" name="partnerId" value={p.id} />
              <ProfileFields cats={cats} values={{ segment: p.segment, categories: p.allowed_categories, domains: p.widget_domains, pct: Number(p.revenue_share_pct), status: p.status, contract: p.contract_ref ?? "" }} idPrefix={p.id} />
            </ActionForm>
          </Panel>
        );
      })}

      <Panel title="New distribution partner" description="Start from a CRM embedded-partner account, an existing distributor organisation, or a new organisation.">
        <ActionForm action={createDistributionPartner} readOnly={!canWrite} submitLabel="Create partner">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start from" htmlFor="np-source">
              <Select id="np-source" name="source" defaultValue="crm">
                <option value="crm">CRM embedded-partner account</option>
                <option value="org">Existing distributor organisation</option>
                <option value="new">New organisation</option>
              </Select>
            </Field>
            <Field label="CRM account" htmlFor="np-crm">
              <Select id="np-crm" name="crm_account_id" defaultValue="">
                <option value="">—</option>
                {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.stage}{a.org_id && taken.has(a.org_id) ? " (already a partner)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Distributor organisation" htmlFor="np-org">
              <Select id="np-org" name="org_id" defaultValue="">
                <option value="">—</option>
                {(orgs ?? []).filter((o) => !taken.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <Field label="New organisation name" htmlFor="np-name"><Input id="np-name" name="name" maxLength={200} placeholder="Accra Auto Mall" /></Field>
          </div>
          <ProfileFields cats={cats} values={{ segment: "car_dealer", categories: [], domains: [], pct: 0, status: "pending", contract: "" }} idPrefix="new" />
        </ActionForm>
      </Panel>
    </div>
  );
}

function ProfileFields({ cats, values, idPrefix }: { cats: { slug: string; name: string }[]; values: { segment: string; categories: string[]; domains: string[]; pct: number; status: string; contract: string }; idPrefix: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Segment" htmlFor={id("segment")}>
        <Select id={id("segment")} name="segment" defaultValue={values.segment}>
          {PARTNER_SEGMENTS.map((s) => <option key={s} value={s}>{PARTNER_SEGMENT_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Status" htmlFor={id("status")} hint="Activating also activates a pending distributor organisation (no NIC licence needed — they do not advise or arrange cover).">
        <Select id={id("status")} name="status" defaultValue={values.status}>
          <option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </Select>
      </Field>
      <Field label="Revenue share (% of Covva's platform fee)" htmlFor={id("pct")} hint="Never a share of the premium.">
        <Input id={id("pct")} name="revenue_share_pct" type="number" min={0} max={100} step={0.5} defaultValue={values.pct} />
      </Field>
      <Field label="Contract reference" htmlFor={id("contract")}><Input id={id("contract")} name="contract_ref" defaultValue={values.contract} maxLength={100} /></Field>
      <Field label="Widget domains" htmlFor={id("domains")} hint="https origins, one per line" className="sm:col-span-2">
        <Textarea id={id("domains")} name="domains" rows={2} defaultValue={values.domains.join("\n")} className="font-mono text-sm" />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium text-ink-2">Categories (none ticked = all available)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {cats.map((c) => (
            <label key={c.slug} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="categories" value={c.slug} defaultChecked={values.categories.includes(c.slug)} className="size-4 accent-brand" /> {c.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
