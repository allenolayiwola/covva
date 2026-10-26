import { Suspense } from "react";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff, mfaRequired } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { orgMap } from "@/lib/query";
import { fmtNum, formatDateTime } from "@/lib/format";
import { KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";

export default function HealthPage() {
  return (
    <>
      <PageHeader title="System health" description="Database connectivity, data volumes, webhook deliveries, background jobs and configuration." />
      <Suspense fallback={<LoadingBlock label="Checking systems…" />}>
        <Health />
      </Suspense>
    </>
  );
}

const ENV: { name: string; required: boolean; purpose: string }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, purpose: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", required: true, purpose: "Supabase publishable key (RLS client)" },
  { name: "NEXT_PUBLIC_SITE_URL", required: true, purpose: "Public web app URL (cache revalidation, invite links)" },
  { name: "NEXT_PUBLIC_ADMIN_URL", required: false, purpose: "This admin app's URL" },
  { name: "SUPABASE_SECRET_KEY", required: false, purpose: "Service key: user invitations, broker-change disclosures, AI usage records, notes" },
  { name: "REVALIDATE_SECRET", required: false, purpose: "Shared secret for POST {site}/api/revalidate" },
  { name: "AI_GATEWAY_API_KEY", required: false, purpose: "Vercel AI Gateway (admin insights); OIDC works on Vercel" },
  { name: "ADMIN_MFA_REQUIRED", required: false, purpose: "Defaults to true. Set to \"false\" only for local demos" },
];

const TABLES = [
  "organizations", "profiles", "requests", "quotes", "policies", "payments", "claims", "complaints", "documents", "usage_events", "ai_usage", "audit_events",
] as const;

async function Health() {
  await requireStaff();
  const supabase = await createClient();
  const t0 = Date.now();
  const ping = await supabase.from("platform_settings").select("key", { head: true, count: "exact" });
  const latency = Date.now() - t0;

  const [counts, { data: deliveries }, { data: endpoints }, { data: cron }, { data: connectors }, orgs, audit] = await Promise.all([
    Promise.all(TABLES.map((t) => supabase.from(t).select("*", { count: "estimated", head: true }).then((r) => ({ table: t, count: r.count, error: r.error?.message })))),
    supabase.from("webhook_deliveries").select("id, endpoint_id, event, status, attempts, next_attempt_at, delivered_at, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("webhook_endpoints").select("id, org_id, url, active, last_status, last_delivery_at"),
    supabase.from("platform_settings").select("key, value, updated_at").like("key", "cron_last_run:%").order("key"),
    supabase.from("connector_configs").select("insurer_org_id, level, status, last_success_at, last_error"),
    orgMap(supabase),
    supabase.rpc("verify_audit_chain", { p_limit: 2000 }),
  ]);
  const endpointById = new Map((endpoints ?? []).map((e) => [e.id, e]));
  const hasEnv = (n: string) => !!process.env[n] && process.env[n]!.trim() !== "";
  const a = audit.data?.[0];

  const Status = ({ ok, warn }: { ok: boolean; warn?: boolean }) =>
    ok ? <CheckCircle2 className="size-4 text-brand" aria-label="OK" /> : warn ? <CircleAlert className="size-4 text-amber" aria-label="Warning" /> : <XCircle className="size-4 text-danger" aria-label="Error" />;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Database">
          <KeyValues
            items={[
              { label: "Connectivity", value: <span className="flex items-center gap-1.5"><Status ok={!ping.error} />{ping.error ? ping.error.message : "Connected"}</span> },
              { label: "Round trip", value: `${latency} ms` },
              { label: "Audit chain (first 2,000)", value: a ? <span className="flex items-center gap-1.5"><Status ok={a.ok} />{a.ok ? "Intact" : `Broken at #${a.first_bad_id}`}</span> : audit.error?.message ?? "—" },
              { label: "MFA gate", value: mfaRequired() ? <Pill tone="ok">Enforced (AAL2)</Pill> : <Pill tone="danger">Disabled</Pill> },
            ]}
          />
        </Panel>
        <Panel title="Record counts" description="Estimated" className="xl:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {counts.map((c) => (
              <div key={c.table} className="flex justify-between gap-2 border-b border-line py-1">
                <dt className="font-mono text-xs text-muted">{c.table}</dt>
                <dd className="tabular-nums text-ink">{c.error ? <span className="text-danger">err</span> : fmtNum(c.count ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Background jobs" description="Last run times written by cron jobs to platform_settings (cron_last_run:*).">
          {cron?.length ? (
            <ul className="space-y-2 text-sm">
              {cron.map((c) => {
                const v = c.value as { at?: string; ok?: boolean; detail?: string } | string | null;
                const at = typeof v === "string" ? v : v?.at ?? c.updated_at;
                const ok = typeof v === "object" && v !== null && "ok" in v ? v.ok !== false : true;
                const stale = Date.now() - new Date(at).getTime() > 26 * 3_600_000;
                return (
                  <li key={c.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><Status ok={ok && !stale} warn={ok && stale} /><span className="font-mono text-xs">{c.key.replace("cron_last_run:", "")}</span></span>
                    <span className="text-xs text-muted">{formatDateTime(at)}{typeof v === "object" && v?.detail ? ` · ${v.detail}` : ""}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No job has reported a run yet. Cron routes (Backend) should upsert <code>cron_last_run:&lt;job&gt;</code> with {"{ at, ok, detail }"}.</p>
          )}
        </Panel>
        <Panel title="Environment" description="Which variables are set for this admin deployment. Values are never shown.">
          <ul className="space-y-2 text-sm">
            {ENV.map((e) => {
              const set = hasEnv(e.name);
              return (
                <li key={e.name} className="flex items-start gap-2">
                  <span className="mt-0.5"><Status ok={set} warn={!set && !e.required} /></span>
                  <span>
                    <span className="font-mono text-xs font-semibold text-ink">{e.name}</span> {e.required ? <Pill tone="neutral">required</Pill> : null}
                    <span className="block text-xs text-muted">{e.purpose}{!set ? " — not set" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Latest webhook deliveries" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <THead><tr><Th>Event</Th><Th>Endpoint</Th><Th>Status</Th><Th>Attempts</Th><Th>Delivered</Th><Th>Created</Th></tr></THead>
          <tbody>
            {(deliveries ?? []).map((d) => {
              const ep = endpointById.get(d.endpoint_id);
              const ok = d.status != null && d.status >= 200 && d.status < 300;
              return (
                <tr key={d.id}>
                  <Td className="font-mono text-xs">{d.event}</Td>
                  <Td className="max-w-xs truncate text-xs">{ep ? `${orgs.get(ep.org_id)?.name ?? ""} · ${ep.url}` : d.endpoint_id.slice(0, 8)}</Td>
                  <Td>{d.status == null ? <Pill tone="wait">pending</Pill> : <Pill tone={ok ? "ok" : "danger"}>{d.status}</Pill>}</Td>
                  <Td>{d.attempts}{d.next_attempt_at && !d.delivered_at && <p className="text-xs text-muted">retry {formatDateTime(d.next_attempt_at)}</p>}</Td>
                  <Td className="text-xs">{formatDateTime(d.delivered_at)}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(d.created_at)}</Td>
                </tr>
              );
            })}
            {!deliveries?.length && <tr><Td colSpan={6} className="py-6 text-center text-muted">No webhook deliveries yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Insurer connectors" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <THead><tr><Th>Insurer</Th><Th>Level</Th><Th>Status</Th><Th>Last success</Th><Th>Last error</Th></tr></THead>
          <tbody>
            {(connectors ?? []).map((c) => (
              <tr key={c.insurer_org_id}>
                <Td>{orgs.get(c.insurer_org_id)?.name}</Td>
                <Td>{c.level.replace("_", " ")}</Td>
                <Td><Pill tone={c.status === "active" ? "ok" : c.status === "error" ? "danger" : "neutral"}>{c.status}</Pill></Td>
                <Td className="text-xs">{formatDateTime(c.last_success_at)}</Td>
                <Td className="max-w-xs truncate text-xs text-danger">{c.last_error ?? ""}</Td>
              </tr>
            ))}
            {!connectors?.length && <tr><Td colSpan={5} className="py-6 text-center text-muted">No connectors configured — insurers use the partner portal (Level 1).</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
