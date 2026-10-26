"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, Notice, Pill } from "@im/ui";

interface Insight { title: string; detail: string; severity: "info" | "watch" | "act"; metric?: string }
interface InsightsResponse { insights: Insight[]; source: "ai" | "rules"; model?: string; note?: string; error?: string }

const tone = { info: "info", watch: "wait", act: "danger" } as const;

/** Operational insights from aggregate metrics. AI output is advisory and labelled as such. */
export function InsightsPanel({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/ai/insights", { method: "POST" });
      const json = (await res.json()) as InsightsResponse;
      if (!res.ok && !json.insights) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate insights");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card as="section" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="size-4 text-brand" aria-hidden /> Operational insights
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Summarises the aggregate metrics above (no personal data is sent). AI-assisted — review before acting; it never makes decisions.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={run} loading={pending} disabled={!enabled} title={enabled ? undefined : "Not available for your role"}>
          {data ? "Regenerate" : "Generate insights"}
        </Button>
      </div>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      {data && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Pill tone={data.source === "ai" ? "info" : "neutral"}>{data.source === "ai" ? `AI-assisted · ${data.model}` : "Rule-based fallback"}</Pill>
            {data.note}
          </p>
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.insights.map((i, n) => (
              <li key={n} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{i.title}</p>
                  <Pill tone={tone[i.severity] ?? "info"}>{i.severity}</Pill>
                </div>
                <p className="mt-1.5 text-sm text-ink-2">{i.detail}</p>
                {i.metric && <p className="mt-2 text-xs text-subtle">{i.metric}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
