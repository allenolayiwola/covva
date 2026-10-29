import { Suspense } from "react";
import Link from "next/link";
import { Globe2 } from "lucide-react";
import { Notice, Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { COUNTRY_OPTIONS, CONSENT_STATUS, relationshipLabel } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock, Pagination, SectionTitle } from "@/components/ui/layout";

/**
 * Diaspora oversight (Roadmap Phase 2): sponsors by country, beneficiaries awaiting consent,
 * sponsorships and gifts, plus a consent audit (who was asked what, when, through which channel).
 * Read-only: consent is captured from the beneficiary's own phone; staff never grant it.
 */
export default function DiasporaPage({ searchParams }: PageProps<"/diaspora">) {
  return (
    <>
      <PageHeader title="Diaspora" description="Sponsors abroad, beneficiaries in Ghana, consent and gifts." />
      <Notice tone="info" icon={<Globe2 className="size-4" />} title="Consent comes from the beneficiary" className="mb-5">
        A sponsor can only arrange cover (or claim by proxy) once the beneficiary accepts by SMS/WhatsApp code or signed link. Staff can see the audit trail here but never grant consent on anyone&apos;s behalf.
      </Notice>
      <Suspense fallback={<LoadingBlock label="Loading diaspora data…" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const countryName = (code: string | null) => COUNTRY_OPTIONS.find((c) => c.code === code)?.name ?? code ?? "—";

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const view = sp(params, "view") ?? "beneficiaries";
  const consentFilter = sp(params, "consent");
  const { page, from, to } = pageOf(params);

  const [{ data: sponsors }, { count: beneficiaryCount }, { count: awaiting }, { count: sponsorshipCount }, { count: giftCount }] = await Promise.all([
    supabase.from("profiles").select("id, country_code").eq("is_sponsor", true).limit(5000),
    supabase.from("beneficiaries").select("id", { count: "exact", head: true }),
    supabase.from("beneficiaries").select("id", { count: "exact", head: true }).neq("consent_status", "granted"),
    supabase.from("sponsorships").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("sponsorships").select("id", { count: "exact", head: true }).eq("gift", true),
  ]);
  const byCountry = new Map<string, number>();
  for (const s of sponsors ?? []) byCountry.set(s.country_code ?? "??", (byCountry.get(s.country_code ?? "??") ?? 0) + 1);
  const countries = [...byCountry.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Sponsors" value={String(sponsors?.length ?? 0)} hint={countries.slice(0, 3).map(([c, n]) => `${countryName(c)} ${n}`).join(" · ") || "No sponsors yet"} />
        <Kpi label="Beneficiaries" value={String(beneficiaryCount ?? 0)} hint={`${awaiting ?? 0} awaiting consent`} />
        <Kpi label="Active sponsorships" value={String(sponsorshipCount ?? 0)} />
        <Kpi label="Gifts" value={String(giftCount ?? 0)} />
      </div>

      {countries.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Sponsors by country</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {countries.map(([c, n]) => (
              <Pill key={c} tone="neutral">{countryName(c)} · {n}</Pill>
            ))}
          </div>
        </section>
      )}

      <FilterBar action="/diaspora">
        <FilterSelect name="view" label="View" value={view} options={[{ value: "beneficiaries", label: "Beneficiaries" }, { value: "sponsorships", label: "Sponsorships & gifts" }, { value: "consents", label: "Consent audit" }]} />
        {view === "beneficiaries" && <FilterSelect name="consent" label="Consent" value={consentFilter} options={Object.entries(CONSENT_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />}
      </FilterBar>

      {view === "beneficiaries" && <Beneficiaries supabase={supabase} params={params} page={page} from={from} to={to} consent={consentFilter} />}
      {view === "sponsorships" && <Sponsorships supabase={supabase} params={params} page={page} from={from} to={to} />}
      {view === "consents" && <ConsentAudit supabase={supabase} params={params} page={page} from={from} to={to} />}
    </>
  );
}

type Db = Awaited<ReturnType<typeof createClient>>;
type ListProps = { supabase: Db; params: SearchParams; page: number; from: number; to: number };

async function Beneficiaries({ supabase, params, page, from, to, consent }: ListProps & { consent?: string }) {
  let q = supabase.from("beneficiaries").select("id, full_name, relationship, phone, sponsor_user_id, linked_user_id, consent_status, consent_channel, consent_sent_at, consent_granted_at, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (consent && consent in CONSENT_STATUS) q = q.eq("consent_status", consent);
  const { data, count, error } = await q;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.flatMap((r) => [r.sponsor_user_id, r.linked_user_id]));
  const sponsorProfiles = rows.length ? (await supabase.from("profiles").select("id, country_code").in("id", [...new Set(rows.map((r) => r.sponsor_user_id))])).data ?? [] : [];
  const country = new Map(sponsorProfiles.map((p) => [p.id, p.country_code]));
  return (
    <>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Beneficiary</Th><Th>Sponsor</Th><Th>Consent</Th><Th>Account</Th><Th>Added</Th></tr></THead>
        <tbody>
          {rows.map((b) => {
            const meta = CONSENT_STATUS[b.consent_status as keyof typeof CONSENT_STATUS] ?? CONSENT_STATUS.pending;
            return (
              <tr key={b.id} className="hover:bg-mist/60">
                <Td><span className="font-semibold text-ink">{b.full_name}</span><p className="text-xs text-muted">{relationshipLabel(b.relationship)} · {b.phone}</p></Td>
                <Td><Link href={`/users/${b.sponsor_user_id}`} className="hover:text-brand">{personName(people.get(b.sponsor_user_id))}</Link><p className="text-xs text-muted">{countryName(country.get(b.sponsor_user_id) ?? null)}</p></Td>
                <Td><Pill tone={meta.tone}>{meta.label}</Pill>{b.consent_sent_at && <p className="text-xs text-muted">{b.consent_channel ?? "—"} · sent {formatDateTime(b.consent_sent_at)}{b.consent_granted_at ? ` · given ${formatDateTime(b.consent_granted_at)}` : ""}</p>}</Td>
                <Td>{b.linked_user_id ? <Link href={`/users/${b.linked_user_id}`} className="hover:text-brand">{personName(people.get(b.linked_user_id))}</Link> : <span className="text-muted">No account</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(b.created_at)}</Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={5} className="py-10 text-center text-muted">No beneficiaries.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/diaspora" params={params} page={page} total={count} />
    </>
  );
}

async function Sponsorships({ supabase, params, page, from, to }: ListProps) {
  const { data, count, error } = await supabase.from("sponsorships").select("id, sponsor_user_id, beneficiary_id, request_id, policy_id, status, gift, gift_revealed_at, notify_beneficiary, started_at, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.sponsor_user_id));
  const beneficiaries = rows.length ? (await supabase.from("beneficiaries").select("id, full_name").in("id", [...new Set(rows.map((r) => r.beneficiary_id))])).data ?? [] : [];
  const names = new Map(beneficiaries.map((b) => [b.id, b.full_name]));
  return (
    <>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Sponsor</Th><Th>Beneficiary</Th><Th>Status</Th><Th>Gift</Th><Th>Policy</Th><Th>Created</Th></tr></THead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-mist/60">
              <Td><Link href={`/users/${s.sponsor_user_id}`} className="hover:text-brand">{personName(people.get(s.sponsor_user_id))}</Link></Td>
              <Td>{names.get(s.beneficiary_id) ?? "—"}<p className="text-xs text-muted">{s.notify_beneficiary ? "Dual notifications on" : "Beneficiary not notified"}</p></Td>
              <Td><Pill tone={s.status === "active" ? "ok" : s.status === "ended" ? "neutral" : "wait"}>{s.status}</Pill></Td>
              <Td>{s.gift ? <Pill tone={s.gift_revealed_at ? "ok" : "info"}>{s.gift_revealed_at ? `Opened ${formatDateTime(s.gift_revealed_at)}` : "Not opened"}</Pill> : <span className="text-muted">—</span>}</Td>
              <Td>{s.policy_id ? <Link href={`/policies/${s.policy_id}`} className="hover:text-brand">Policy</Link> : s.request_id ? <Link href={`/requests/${s.request_id}`} className="hover:text-brand">Request</Link> : "—"}</Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(s.created_at)}</Td>
            </tr>
          ))}
          {!rows.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No sponsorships.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/diaspora" params={params} page={page} total={count} />
    </>
  );
}

async function ConsentAudit({ supabase, params, page, from, to }: ListProps) {
  const { data, count, error } = await supabase.from("beneficiary_consents").select("id, beneficiary_id, kind, granted, granted_at, declined_at, channel, requested_at, expires_at, attempts, locked_at, requested_by", { count: "exact" }).order("updated_at", { ascending: false }).range(from, to);
  const rows = data ?? [];
  const beneficiaries = rows.length ? (await supabase.from("beneficiaries").select("id, full_name, sponsor_user_id").in("id", [...new Set(rows.map((r) => r.beneficiary_id))])).data ?? [] : [];
  const bMap = new Map(beneficiaries.map((b) => [b.id, b]));
  const people = await profileMap(supabase, beneficiaries.map((b) => b.sponsor_user_id));
  return (
    <>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Beneficiary</Th><Th>Kind</Th><Th>Outcome</Th><Th>Channel</Th><Th>Requested</Th><Th>Attempts</Th></tr></THead>
        <tbody>
          {rows.map((c) => {
            const b = bMap.get(c.beneficiary_id);
            return (
              <tr key={c.id} className="hover:bg-mist/60">
                <Td><span className="font-semibold text-ink">{b?.full_name ?? "—"}</span><p className="text-xs text-muted">sponsor {personName(people.get(b?.sponsor_user_id ?? ""))}</p></Td>
                <Td>{c.kind.replace(/_/g, " ")}</Td>
                <Td>{c.granted ? <Pill tone="ok">Given {c.granted_at ? formatDateTime(c.granted_at) : ""}</Pill> : c.declined_at ? <Pill tone="danger">Declined {formatDateTime(c.declined_at)}</Pill> : c.locked_at ? <Pill tone="danger">Locked</Pill> : c.expires_at && new Date(c.expires_at) < new Date() ? <Pill tone="neutral">Expired</Pill> : <Pill tone="wait">Pending</Pill>}</Td>
                <Td>{c.channel ?? "—"}</Td>
                <Td className="whitespace-nowrap text-muted">{c.requested_at ? formatDateTime(c.requested_at) : "—"}</Td>
                <Td className="tabular-nums">{c.attempts}</Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No consent requests yet.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/diaspora" params={params} page={page} total={count} />
    </>
  );
}
