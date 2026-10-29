import { Suspense } from "react";
import { Field, Input, Pill, Select, Textarea } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Kpi, LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { setFxSettings, setManualRate } from "./actions";

const CURRENCIES = ["GBP", "USD", "EUR", "CAD"] as const;
const SOURCE_TONE = { manual: "wait", openexchangerates: "ok", bog: "ok", provider: "info" } as const;

export default function FxPage() {
  return (
    <>
      <PageHeader
        title="FX rates (diaspora display)"
        description="Indicative GHS-per-unit rates used to show GBP / USD / EUR / CAD amounts at checkout. The insurer is always paid the GHS contract amount; the card issuer or PSP applies the final rate. Rates are append-only; manual overrides are flagged to payers."
      />
      <Suspense fallback={<LoadingBlock label="Loading rates…" />}>
        <Fx />
      </Suspense>
    </>
  );
}

async function Fx() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const canRate = can(staff.roles, "operations");
  const canSettings = can(staff.roles, "platform");
  const [{ data: rows }, { data: setting }, { data: lastRun }] = await Promise.all([
    supabase.from("fx_rates").select("*").order("fetched_at", { ascending: false }).limit(200),
    supabase.from("platform_settings").select("value").eq("key", "fx").maybeSingle(),
    supabase.from("platform_settings").select("value").eq("key", "cron_last_run:fx-rates").maybeSingle(),
  ]);
  const fx = (setting?.value ?? {}) as { margin_pct?: number; provider?: string };
  const latest = new Map<string, NonNullable<typeof rows>[number]>();
  for (const r of rows ?? []) if (!latest.has(r.quote)) latest.set(r.quote, r);
  const run = (lastRun?.value ?? null) as { at?: string; ok?: boolean; result?: Record<string, unknown> } | null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {CURRENCIES.map((c) => {
          const r = latest.get(c);
          return <Kpi key={c} label={`1 ${c} in GHS`} value={r ? Number(r.rate).toFixed(4) : "—"} hint={r ? `${r.source} · ${formatDateTime(r.fetched_at)}` : "no rate yet"} tone={r?.source === "manual" ? "warn" : "default"} />;
        })}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Manual override" description="Appends a manual rate (flagged “indicative, set by operations” to payers). Use when the provider is down or before launch. Recorded in the audit log.">
          <ActionForm action={setManualRate} submitLabel="Save manual rate" readOnly={!canRate}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" htmlFor="fx-q">
                <Select id="fx-q" name="quote" defaultValue="GBP">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="GHS per 1 unit" htmlFor="fx-r"><Input id="fx-r" name="rate" type="number" step="0.0001" min={0} required placeholder="20.5000" /></Field>
              <Field label="Valid for (hours)" htmlFor="fx-h"><Input id="fx-h" name="validHours" type="number" min={1} max={336} defaultValue={24} /></Field>
              <Field label="Source note" htmlFor="fx-n" className="sm:col-span-2"><Textarea id="fx-n" name="note" rows={2} required placeholder="e.g. Bank of Ghana interbank mid-rate, 26 Oct 2026" /></Field>
            </div>
          </ActionForm>
        </Panel>
        <Panel title="Display settings" description="Margin: a buffer added to the indicative foreign amount for the PSP's conversion spread (shown to the payer; Covva never collects it). Provider: what the hourly `fx-rates` cron fetches.">
          <ActionForm action={setFxSettings} submitLabel="Save settings" readOnly={!canSettings}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="FX margin %" htmlFor="fx-m" hint="0 = show the provider rate as-is. Max 10."><Input id="fx-m" name="marginPct" type="number" step="0.01" min={0} max={10} defaultValue={Number(fx.margin_pct ?? 0)} /></Field>
              <Field label="Rate provider" htmlFor="fx-p" hint="FX_PROVIDER env overrides this.">
                <Select id="fx-p" name="provider" defaultValue={fx.provider ?? "manual"}>
                  <option value="manual">Manual (no fetch)</option>
                  <option value="openexchangerates">Open Exchange Rates (needs OPENEXCHANGERATES_APP_ID)</option>
                  <option value="bog">Bank of Ghana (stub — not integrated)</option>
                </Select>
              </Field>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">Last cron run: {run?.at ? `${formatDateTime(run.at)} · ${run.ok ? "ok" : "failed"} · ${JSON.stringify(run.result ?? {})}` : "never"}</p>
        </Panel>
      </div>
      <Panel title="Rate history" description="Newest first. Every row is kept; the newest per currency is what checkout uses.">
        <Table>
          <THead><tr><Th>Currency</Th><Th>GHS per unit</Th><Th>Source</Th><Th>Fetched</Th><Th>Valid until</Th><Th>Note</Th></tr></THead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.quote}</Td>
                <Td className="tabular-nums">{Number(r.rate).toFixed(6)}</Td>
                <Td><Pill tone={SOURCE_TONE[r.source as keyof typeof SOURCE_TONE] ?? "neutral"}>{r.source}</Pill></Td>
                <Td className="text-xs">{formatDateTime(r.fetched_at)}</Td>
                <Td className="text-xs">{r.valid_until ? formatDateTime(r.valid_until) : "—"}</Td>
                <Td className="text-xs text-muted">{r.note ?? ""}</Td>
              </tr>
            ))}
            {!rows?.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No rates yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
