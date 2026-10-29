import { Suspense } from "react";
import { Field, Input, Notice } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { DAY, median } from "@/lib/query";
import { fmtNum, fmtPct, fmtUSD, formatDate } from "@/lib/format";
import { AI_FLAGS, DEFAULT_MODELS } from "@/lib/ai";
import { Kpi, LoadingBlock, Panel } from "@/components/ui/layout";
import { Bars } from "@/components/ui/charts";
import { ActionForm, ToggleForm } from "@/components/ui/forms";
import { toggleFlag } from "../flags/actions";
import { saveAiModels } from "./actions";
import { InsightsPanel } from "./InsightsPanel";

export default function AiPage() {
  return (
    <>
      <PageHeader title="AI" description="Usage, cost and reliability of AI features via the Vercel AI Gateway. AI explains, summarises, extracts and drafts — it never makes suitability or claim decisions." />
      <Suspense fallback={<LoadingBlock label="Loading AI usage…" />}>
        <Ai />
      </Suspense>
    </>
  );
}

type Agg = { calls: number; ok: number; input: number; output: number; cost: number; latency: number[] };
const empty = (): Agg => ({ calls: 0, ok: 0, input: 0, output: 0, cost: 0, latency: [] });

async function Ai() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const since = new Date(Date.now() - 29 * DAY);
  const start = new Date(since.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const [{ data: rows }, { data: modelsRow }, { data: flags }] = await Promise.all([
    supabase.from("ai_usage").select("feature, model, input_tokens, output_tokens, cost_usd, latency_ms, success, created_at").gte("created_at", new Date(start).toISOString()).limit(50000),
    supabase.from("platform_settings").select("value").eq("key", "ai_models").maybeSingle(),
    supabase.from("feature_flags").select("key, enabled, description").in("key", AI_FLAGS.map((f) => f.key)),
  ]);
  const models = { ...DEFAULT_MODELS, ...((modelsRow?.value as Record<string, string> | null) ?? {}) };
  const flagMap = new Map((flags ?? []).map((f) => [f.key, f]));
  const canPlatform = can(staff.roles, "platform");

  const byFeature = new Map<string, Agg>();
  const byModel = new Map<string, Agg>();
  const total = empty();
  const dailyCost = Array.from({ length: 30 }, () => 0);
  const dailyCalls = Array.from({ length: 30 }, () => 0);
  for (const r of rows ?? []) {
    for (const [map, k] of [[byFeature, r.feature], [byModel, r.model]] as const) {
      const a = map.get(k) ?? empty();
      a.calls++; if (r.success) a.ok++; a.input += r.input_tokens; a.output += r.output_tokens; a.cost += Number(r.cost_usd ?? 0); if (r.latency_ms != null) a.latency.push(r.latency_ms);
      map.set(k, a);
    }
    total.calls++; if (r.success) total.ok++; total.input += r.input_tokens; total.output += r.output_tokens; total.cost += Number(r.cost_usd ?? 0); if (r.latency_ms != null) total.latency.push(r.latency_ms);
    const i = Math.floor((new Date(r.created_at).getTime() - start) / DAY);
    if (i >= 0 && i < 30) { dailyCost[i]! += Number(r.cost_usd ?? 0); dailyCalls[i]!++; }
  }
  const table = (title: string, map: Map<string, Agg>) => (
    <Panel title={title} bodyClassName="p-0">
      <Table className="rounded-none border-0">
        <THead><tr><Th>{title.replace("By ", "")}</Th><Th>Calls</Th><Th>Tokens in / out</Th><Th>Cost</Th><Th>Success</Th><Th>Median latency</Th></tr></THead>
        <tbody>
          {[...map.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, a]) => (
            <tr key={k}>
              <Td className="font-mono text-xs">{k}</Td>
              <Td className="tabular-nums">{fmtNum(a.calls)}</Td>
              <Td className="tabular-nums text-xs">{fmtNum(a.input)} / {fmtNum(a.output)}</Td>
              <Td className="tabular-nums">{fmtUSD(a.cost, 4)}</Td>
              <Td className={a.ok / a.calls < 0.95 ? "text-danger" : ""}>{fmtPct(a.ok / a.calls, 1)}</Td>
              <Td className="tabular-nums">{a.latency.length ? `${Math.round(median(a.latency)!)} ms` : "—"}</Td>
            </tr>
          ))}
          {!map.size && <tr><Td colSpan={6} className="py-6 text-center text-muted">No AI usage in the last 30 days.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Calls (30 days)" value={fmtNum(total.calls)} />
        <Kpi label="Tokens" value={fmtNum(total.input + total.output)} hint={`${fmtNum(total.input)} in · ${fmtNum(total.output)} out`} />
        <Kpi label="Cost" value={fmtUSD(total.cost)} hint="As reported by the AI Gateway" />
        <Kpi label="Success rate" value={total.calls ? fmtPct(total.ok / total.calls, 1) : "—"} tone={total.calls && total.ok / total.calls < 0.95 ? "danger" : "default"} hint={total.latency.length ? `Median latency ${Math.round(median(total.latency)!)} ms` : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Cost per day (USD)">
          <Bars data={dailyCost.map((v, i) => ({ label: formatDate(new Date(start + i * DAY)), value: v }))} format={(n) => fmtUSD(n, 4)} height={110} />
        </Panel>
        <Panel title="Calls per day">
          <Bars data={dailyCalls.map((v, i) => ({ label: formatDate(new Date(start + i * DAY)), value: v }))} height={110} />
        </Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {table("By feature", byFeature)}
        {table("By model", byModel)}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Model settings" description="Stored in platform_settings.ai_models and read by every AI feature (plain AI Gateway ids).">
          <ActionForm action={saveAiModels} submitLabel="Save models" readOnly={!canPlatform}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Default model" htmlFor="m-default" hint="Quality-sensitive tasks"><Input id="m-default" name="default" defaultValue={models.default} className="font-mono text-sm" /></Field>
              <Field label="Fast model" htmlFor="m-fast" hint="Classification, extraction"><Input id="m-fast" name="fast" defaultValue={models.fast} className="font-mono text-sm" /></Field>
              <Field label="Vision model" htmlFor="m-vision" hint="Document & photo extraction"><Input id="m-vision" name="vision" defaultValue={models.vision} className="font-mono text-sm" /></Field>
            </div>
          </ActionForm>
          {!process.env.AI_GATEWAY_API_KEY && <Notice tone="wait" className="mt-4">AI_GATEWAY_API_KEY is not set for the admin app — insights fall back to rule-based summaries.</Notice>}
        </Panel>
        <Panel title="AI feature flags">
          <ul className="divide-y divide-line">
            {AI_FLAGS.map((f) => {
              const row = flagMap.get(f.key);
              return (
                <li key={f.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-ink">{f.key}</p>
                    <p className="text-xs text-muted">{row?.description ?? f.description}{!row && " (not yet created)"}</p>
                  </div>
                  <ToggleForm action={toggleFlag} fields={{ key: f.key, description: row?.description ?? f.description }} checked={row?.enabled ?? false} label={`Toggle ${f.key}`} disabled={!canPlatform} />
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <InsightsPanel enabled={can(staff.roles, "insights")} />
    </div>
  );
}

