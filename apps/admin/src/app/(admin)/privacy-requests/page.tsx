import { Suspense } from "react";
import Link from "next/link";
import { Pill, StatusPill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import {
  PENDING_PRIVACY_STATUSES,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS,
  RETENTION_RULES,
  normaliseRetentionConfig,
  privacyDeadline,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterCheck, FilterInput, FilterSelect, LoadingBlock, Pagination, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { previewRetention } from "./actions";

export default function PrivacyRequestsPage({ searchParams }: PageProps<"/privacy-requests">) {
  return (
    <>
      <PageHeader
        title="Privacy requests"
        description="Act 843 data-subject requests: access / export, correction, deletion (anonymisation), objection and marketing opt-out. Verify identity first; every action is audited."
      />
      <Suspense fallback={<LoadingBlock label="Loading privacy requests…" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <RetentionRuns />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const status = sp(params, "status");
  const type = sp(params, "type");
  const overdue = sp(params, "overdue") === "1";
  const q = sp(params, "q");
  const now = new Date();

  let query = supabase
    .from("privacy_requests")
    .select("id, reference, user_id, type, status, channel, due_at, created_at, identity_verified_at", { count: "exact" })
    .order("due_at", { ascending: true })
    .range(from, to);
  if (status === "open") query = query.in("status", [...PENDING_PRIVACY_STATUSES, "export_ready"]);
  else if (status && status in PRIVACY_STATUS) query = query.eq("status", status as PrivacyRequestStatus);
  if (type && type in PRIVACY_REQUEST_TYPES) query = query.eq("type", type as PrivacyRequestType);
  if (overdue) query = query.in("status", [...PENDING_PRIVACY_STATUSES]).lt("due_at", now.toISOString());
  if (q && /^DSR-\d+$/i.test(q.trim())) query = query.eq("reference", q.trim().toUpperCase());
  const { data, count, error } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.map((r) => r.user_id));

  return (
    <>
      <FilterBar action="/privacy-requests">
        <FilterInput name="q" label="Reference" value={q} placeholder="DSR-1001" />
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[{ value: "open", label: "All open" }, ...Object.entries(PRIVACY_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]}
        />
        <FilterSelect name="type" label="Type" value={type} options={Object.entries(PRIVACY_REQUEST_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterCheck name="overdue" label="Overdue" checked={overdue} />
      </FilterBar>
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead>
          <tr><Th>Request</Th><Th>Person</Th><Th>Type</Th><Th>Status</Th><Th>Due</Th><Th>Received</Th></tr>
        </THead>
        <tbody>
          {rows.map((r) => {
            const d = privacyDeadline(r, now);
            return (
              <tr key={r.id} className="hover:bg-mist/60">
                <Td>
                  <Link href={`/privacy-requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference}</Link>
                  <p className="text-[13px] text-muted">via {r.channel}</p>
                </Td>
                <Td>{personName(people.get(r.user_id), "Deleted customer")}</Td>
                <Td>{PRIVACY_REQUEST_TYPES[r.type].label}</Td>
                <Td><StatusPill meta={PRIVACY_STATUS[r.status]} /></Td>
                <Td>{d.daysLeft === null ? "—" : <span className={d.overdue ? "font-medium text-danger" : (d.daysLeft ?? 99) <= 5 ? "text-amber" : ""}>{d.label}</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No privacy requests.</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/privacy-requests" params={params} page={page} total={count} />
    </>
  );
}

async function RetentionRuns() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: runs }, { data: setting }] = await Promise.all([
    supabase.from("privacy_retention_runs").select("id, started_at, dry_run, triggered_by, ok, results").order("started_at", { ascending: false }).limit(10),
    supabase.from("platform_settings").select("value").eq("key", "privacy_retention").maybeSingle(),
  ]);
  const config = normaliseRetentionConfig(setting?.value);
  return (
    <Panel
      className="mt-8"
      title="Retention job"
      description={
        <>
          Daily at 03:50 UTC (<code>/api/cron/privacy-retention</code>). Mode: <strong>{config.mode === "enforce" ? "enforce" : "dry run (report only)"}</strong> — change it in
          Settings → <code>privacy_retention</code> once the periods are confirmed with counsel. E2E and demo data are never touched.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Periods</h3>
          <ul className="space-y-1.5 text-sm">
            {RETENTION_RULES.map((r) => (
              <li key={r.class} className="flex justify-between gap-3">
                <span className="text-ink-2" title={r.description}>{r.label}</span>
                <span className="tabular-nums text-muted">{config.periods[r.class]} days · {r.action}</span>
              </li>
            ))}
          </ul>
          {config.warnings.length > 0 && <p className="mt-2 text-[13px] text-danger">{config.warnings.join(" · ")}</p>}
          <ActionForm action={previewRetention} submitLabel="Run a dry run now" submitVariant="secondary" readOnly={!can(staff.roles, "privacy")} className="mt-4" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Recent runs</h3>
          {(runs ?? []).length === 0 ? (
            <p className="text-sm text-muted">No runs yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(runs ?? []).map((run) => {
                const results = (run.results ?? {}) as Record<string, { count?: number; error?: string }>;
                const touched = Object.values(results).reduce((a, r) => a + (r.count ?? 0), 0);
                const errors = Object.entries(results).filter(([, r]) => r.error);
                return (
                  <li key={run.id} className="rounded-field border border-line px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-muted">{formatDateTime(run.started_at)}</span>
                      <Pill tone={run.dry_run ? "info" : "ok"}>{run.dry_run ? "Dry run" : "Enforced"}</Pill>
                      <span className="text-muted">{run.triggered_by}</span>
                      {!run.ok && <Pill tone="danger">Errors</Pill>}
                    </span>
                    <span className="block text-ink-2">{touched} row{touched === 1 ? "" : "s"} {run.dry_run ? "due" : "erased"}</span>
                    {errors.map(([k, r]) => <span key={k} className="block text-[13px] text-danger">{k}: {r.error}</span>)}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
