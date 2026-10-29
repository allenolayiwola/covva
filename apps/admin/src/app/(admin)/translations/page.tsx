import { Suspense } from "react";
import Link from "next/link";
import { Field, Input, Pill, Select, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { LOCALES, MESSAGE_KEYS, catalogueCoverage, en, localeDef, mergeCatalogue, normaliseLocale, type Locale } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { PAGE_SIZE, sp, type SearchParams } from "@/lib/query";
import { Kpi, LoadingBlock, Pagination, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { fromTable, type TranslationRow } from "@/lib/phase3-tables";
import { approveReviewed, importTranslations, saveTranslation } from "./actions";

const STATUS_TONE = { draft: "neutral", reviewed: "info", approved: "ok" } as const;
const SHOW = [
  { value: "missing", label: "Missing (no approved string)" },
  { value: "draft", label: "Draft" },
  { value: "reviewed", label: "Reviewed — awaiting approval" },
  { value: "approved", label: "Approved (live)" },
] as const;

export default function TranslationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <>
      <PageHeader
        title="Translations"
        description="UI strings for Twi, Ga and Ewe, written and checked by people — never machine-translated. English is the source (packages/core/src/i18n/en.ts). Draft → reviewed (a second speaker checked it) → approved (live on the web app and the mobile catalogue). Untranslated text is shown in English with an honest notice."
      />
      <Suspense fallback={<LoadingBlock label="Loading translations…" />}>
        <Translations searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Translations({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const staff = await requireStaff();
  const supabase = await createClient();
  const canEdit = can(staff.roles, "translations");
  const canApprove = can(staff.roles, "translationsApprove");
  const locale = (normaliseLocale(sp(params, "locale")) ?? "tw") as Locale;
  const active: Locale = locale === "en" ? "tw" : locale;
  const show = sp(params, "show");
  const q = sp(params, "q")?.toLowerCase();
  const page = Math.max(1, Number.parseInt(sp(params, "page") ?? "1", 10) || 1);

  const { data, error } = await fromTable(supabase, "translations").select("*").order("updated_at", { ascending: false }).limit(20000);
  const rows = (data ?? []) as TranslationRow[];
  const byLocale = new Map<string, TranslationRow[]>();
  for (const r of rows) byLocale.set(r.locale, [...(byLocale.get(r.locale) ?? []), r]);
  const mine = new Map((byLocale.get(active) ?? []).map((r) => [r.key, r]));

  let keys = [...MESSAGE_KEYS];
  if (q) keys = keys.filter((k) => k.toLowerCase().includes(q) || en[k].toLowerCase().includes(q) || (mine.get(k)?.value ?? "").toLowerCase().includes(q));
  if (show === "missing") keys = keys.filter((k) => mine.get(k)?.status !== "approved");
  else if (show === "draft" || show === "reviewed" || show === "approved") keys = keys.filter((k) => mine.get(k)?.status === show);
  const total = keys.length;
  const pageKeys = keys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reviewedCount = [...mine.values()].filter((r) => r.status === "reviewed").length;
  const base = "/translations";

  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canEdit} />
      {error && <p className="rounded-card border border-danger/30 bg-danger/5 p-3 text-sm text-danger">Couldn&apos;t load translations: {error.message}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        {LOCALES.map((l) => {
          const cov = catalogueCoverage(l.code, mergeCatalogue(l.code, byLocale.get(l.code) ?? []));
          const drafts = (byLocale.get(l.code) ?? []).filter((r) => r.status !== "approved").length;
          return (
            <Link key={l.code} href={l.code === "en" ? base : `${base}?locale=${l.code}`} className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <Kpi
                label={`${l.label} (${l.native})`}
                value={`${cov.pct}%`}
                hint={l.code === "en" ? `${cov.total} keys · source` : `${cov.translated}/${cov.total} approved · ${drafts} in progress · ${cov.status}`}
                tone={l.code === "en" ? "default" : cov.status === "complete" ? "default" : "warn"}
              />
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={`Import CSV — ${localeDef(active).label}`} description="Columns key,value (header optional). Unknown keys and placeholder mismatches are rejected. Imports arrive as draft or reviewed; approved strings are kept unless you tick overwrite.">
          <ActionForm action={importTranslations} submitLabel="Import" readOnly={!canEdit}>
            <input type="hidden" name="locale" value={active} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="CSV file" htmlFor="tr-file"><Input id="tr-file" name="file" type="file" accept=".csv,text/csv" /></Field>
              <Field label="Import as" htmlFor="tr-status">
                <Select id="tr-status" name="status" defaultValue="draft">
                  <option value="draft">Draft</option>
                  <option value="reviewed">Reviewed (second speaker has checked)</option>
                </Select>
              </Field>
              <Field label="…or paste CSV" htmlFor="tr-csv" className="sm:col-span-2"><Textarea id="tr-csv" name="csv" rows={4} placeholder={'key,value\nnav.claims,"…"'} /></Field>
              <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2"><input type="checkbox" name="overwriteApproved" className="size-4 accent-brand" /> Overwrite approved strings (they go back to the chosen status)</label>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">
            <a className="font-medium text-brand hover:underline" href={`${base}/export?locale=${active}&only=missing`}>Download missing keys as CSV</a> ·{" "}
            <a className="font-medium text-brand hover:underline" href={`${base}/export?locale=${active}`}>Download all keys</a> (key, English, current value) for translators.
          </p>
        </Panel>
        <Panel title="Review and approve" description="Approving makes strings live for every visitor who picked this language (cache refreshed immediately). Approve only after a fluent second speaker has reviewed them.">
          <p className="text-sm text-ink-2">{reviewedCount} reviewed {localeDef(active).label} string(s) waiting for approval.</p>
          <ActionForm action={approveReviewed} submitLabel={`Approve all reviewed ${localeDef(active).label}`} readOnly={!canApprove || !reviewedCount} className="mt-3">
            <input type="hidden" name="locale" value={active} />
          </ActionForm>
        </Panel>
      </div>

      <form action={base} method="get" className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Locale
          <select name="locale" defaultValue={active} className="h-9 rounded-md border border-line bg-white px-2.5 text-sm text-ink">
            {LOCALES.filter((l) => l.code !== "en").map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Show
          <select name="show" defaultValue={show ?? ""} className="h-9 rounded-md border border-line bg-white px-2.5 text-sm text-ink">
            <option value="">All keys</option>
            {SHOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Search
          <input name="q" defaultValue={q ?? ""} placeholder="key or text" className="h-9 w-56 rounded-md border border-line bg-white px-2.5 text-sm text-ink" />
        </label>
        <button type="submit" className="h-9 rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">Apply</button>
      </form>

      <Panel title={`${localeDef(active).label} strings`} description="Placeholders in braces ({name}, {count, plural, …}) must be kept exactly. USSD strings must stay within 160 characters per screen." bodyClassName="p-0">
        <Table>
          <THead><tr><Th>Key</Th><Th>English (source)</Th><Th>{localeDef(active).label}</Th></tr></THead>
          <tbody>
            {pageKeys.map((k) => {
              const r = mine.get(k);
              return (
                <tr key={k} className="align-top">
                  <Td className="w-56 font-mono text-[11.5px] text-ink-2">{k}</Td>
                  <Td className="max-w-sm whitespace-pre-wrap text-sm">{en[k]}</Td>
                  <Td className="min-w-[340px]">
                    {r && (
                      <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill> updated {formatDateTime(r.updated_at)}
                        {r.reviewed_at ? ` · reviewed ${formatDateTime(r.reviewed_at)}` : ""}
                      </p>
                    )}
                    <ActionForm action={saveTranslation} submitLabel="Save" readOnly={!canEdit} audited={false} className="space-y-2">
                      <input type="hidden" name="locale" value={active} />
                      <input type="hidden" name="key" value={k} />
                      <label className="sr-only" htmlFor={`v-${k}`}>{localeDef(active).label} text for {k}</label>
                      <Textarea id={`v-${k}`} name="value" rows={Math.min(6, Math.max(2, Math.ceil(en[k].length / 60)))} defaultValue={r?.value ?? ""} lang={localeDef(active).htmlLang} />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`s-${k}`}>Status for {k}</label>
                        <Select id={`s-${k}`} name="status" defaultValue={r?.status ?? "draft"} className="h-9 w-auto text-sm">
                          <option value="draft">Draft</option>
                          <option value="reviewed">Reviewed</option>
                          <option value="approved" disabled={!canApprove}>Approved (live)</option>
                        </Select>
                        <label className="sr-only" htmlFor={`n-${k}`}>Note for {k}</label>
                        <Input id={`n-${k}`} name="note" defaultValue={r?.note ?? ""} placeholder="Note (optional)" className="h-9 w-48 text-sm" />
                      </div>
                    </ActionForm>
                  </Td>
                </tr>
              );
            })}
            {!pageKeys.length && <tr><Td colSpan={3} className="py-8 text-center text-muted">No keys match.</Td></tr>}
          </tbody>
        </Table>
        <div className="px-5 pb-4">
          <Pagination base={base} params={params} page={page} total={total} />
        </div>
      </Panel>
    </div>
  );
}
