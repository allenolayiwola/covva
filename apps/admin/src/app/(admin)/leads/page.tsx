import { Suspense } from "react";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, Kpi, LoadingBlock, Pagination } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { updateLead } from "./actions";

const STATUS = ["new", "contacted", "qualified", "closed"] as const;
const TONE = { new: "info", contacted: "wait", qualified: "ok", closed: "neutral" } as const;
const KINDS: Enum<"lead_kind">[] = ["customer", "broker", "insurer", "enterprise", "press", "other"];

export default function LeadsPage({ searchParams }: PageProps<"/leads">) {
  return (
    <>
      <PageHeader title="Leads" description="Enquiries from the marketing site — partner applications, enterprise interest, press and customers." />
      <Suspense fallback={<LoadingBlock label="Loading leads…" />}>
        <Leads searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Leads({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const kind = sp(params, "kind");
  const q = sp(params, "q");
  let query = supabase.from("leads").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (status && (STATUS as readonly string[]).includes(status)) query = query.eq("status", status);
  if (kind && (KINDS as string[]).includes(kind)) query = query.eq("kind", kind as Enum<"lead_kind">);
  if (q) query = query.or(`name.ilike.${ilikeTerm(q)},email.ilike.${ilikeTerm(q)},organization.ilike.${ilikeTerm(q)}`);
  const [{ data, count }, ...counts] = await Promise.all([
    query,
    ...STATUS.map((s) => supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", s)),
  ]);
  const canAct = can(staff.roles, "leads");

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {STATUS.map((s, i) => <Kpi key={s} label={s[0]!.toUpperCase() + s.slice(1)} value={counts[i]?.count ?? 0} href={`/leads?status=${s}`} tone={s === "new" && (counts[i]?.count ?? 0) > 0 ? "warn" : "default"} />)}
      </div>
      <FilterBar action="/leads">
        <FilterInput name="q" label="Name, email or organisation" value={q} />
        <FilterSelect name="status" label="Status" value={status} options={STATUS.map((s) => ({ value: s, label: s }))} />
        <FilterSelect name="kind" label="Kind" value={kind} options={KINDS.map((k) => ({ value: k, label: k }))} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Lead</Th><Th>Kind</Th><Th>Message</Th><Th>Source</Th><Th>Received</Th><Th>Status & notes</Th></tr></THead>
        <tbody>
          {(data ?? []).map((l) => {
            const utm = (l.utm as Record<string, unknown> | null) ?? {};
            const notes = (Array.isArray(utm._admin_notes) ? utm._admin_notes : []) as { note: string; by_name?: string; at: string }[];
            const utmPublic = Object.entries(utm).filter(([k]) => !k.startsWith("_"));
            return (
              <tr key={l.id} className="align-top">
                <Td>
                  <p className="font-semibold text-ink">{l.name}</p>
                  {l.organization && <p className="text-xs text-ink-2">{l.organization}</p>}
                  <p className="text-xs text-muted">{l.email ?? ""}{l.phone ? ` · ${l.phone}` : ""}</p>
                </Td>
                <Td className="capitalize">{l.kind}{l.category_slug && <p className="text-xs text-muted">{l.category_slug}</p>}</Td>
                <Td className="max-w-xs whitespace-pre-line text-xs text-ink-2">{l.message ?? "—"}</Td>
                <Td className="text-xs text-muted">{l.source_page ?? "—"}{utmPublic.length > 0 && <p>{utmPublic.map(([k, v]) => `${k}=${String(v)}`).join(" · ")}</p>}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(l.created_at)}</Td>
                <Td className="min-w-72">
                  <Pill tone={TONE[(l.status as keyof typeof TONE) ?? "new"] ?? "neutral"}>{l.status}</Pill>
                  {notes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {notes.slice(-3).map((n, i) => <li key={i} className="text-ink-2">{n.note} <span className="text-subtle">— {n.by_name ?? "staff"}, {formatDateTime(n.at)}</span></li>)}
                    </ul>
                  )}
                  <div className="mt-2">
                    <ActionForm action={updateLead} inline submitLabel="Update" submitVariant="secondary" readOnly={!canAct}>
                      <input type="hidden" name="leadId" value={l.id} />
                      <select name="status" defaultValue={l.status} className="h-9 rounded-md border border-line bg-white px-2 text-sm" aria-label="Status">
                        {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input name="note" placeholder="Add a note" className="h-9 w-40 rounded-md border border-line px-2 text-sm" aria-label="Note" />
                    </ActionForm>
                  </div>
                </Td>
              </tr>
            );
          })}
          {!data?.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No leads.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/leads" params={params} page={page} total={count} />
    </>
  );
}
