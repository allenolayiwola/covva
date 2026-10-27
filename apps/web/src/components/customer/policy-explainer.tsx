"use client";
import * as React from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, MessageSquare, Quote, Send, Sparkles } from "lucide-react";
import { EXPLAINER_DISCLAIMER, EXPLAINER_SUGGESTIONS, buildHandoffMessage, type CheckedStatement, type Citation, type GroundingClause } from "@im/core";
import { Button, Notice, Spinner, buttonClass, cn } from "@im/ui";

/**
 * "Explain my policy" panel (Addendum 6.3). Mobile-first; every control is at least 40px tall and
 * no text is smaller than 13px. Answers come from POST /api/v1/me/policies/{id}/explain and every
 * statement carries citation chips that open the exact clause text. Without AI the panel still
 * offers the clause browser, keyword matches and the broker hand-off.
 */

type ClauseLite = Pick<GroundingClause, "id" | "heading" | "group" | "text">;
export interface ExplainerSummaryView { statements: CheckedStatement[]; source: "cache" | "generated" | "fallback"; aiAssisted: boolean; label: string }
export interface ExplainerHandoffView { available: boolean; brokerName: string | null; threadHref: string | null; reason: string | null }

interface AskResult {
  mode: "ai" | "clauses_only";
  logId: string | null;
  question: string;
  advisory: boolean;
  reasons: string[];
  status: "answered" | "not_in_wording";
  statements: CheckedStatement[];
  matches: ClauseLite[];
  notice: string | null;
  aiAssisted: boolean;
  label: string | null;
}

async function callExplain<T>(policyId: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/v1/me/policies/${policyId}/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? (res.status === 429 ? "Too many questions in a row. Please wait a minute." : "Something went wrong. Please try again."));
  return json.data as T;
}

function CitationChips({ citations, idPrefix }: { citations: Citation[]; idPrefix: string }) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="mt-1.5">
      <ul className="flex flex-wrap gap-1.5" aria-label="Sources in your policy">
        {citations.map((c) => {
          const panelId = `${idPrefix}-${c.id.replace(/[^\w-]/g, "_")}`;
          const expanded = open === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen(expanded ? null : c.id)}
                className={cn(
                  "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  expanded ? "border-brand bg-mint text-brand-deep" : "border-line bg-white text-brand-deep hover:bg-mist",
                )}
              >
                <Quote aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{c.heading}</span>
                <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
              </button>
            </li>
          );
        })}
      </ul>
      {citations.map((c) => {
        const panelId = `${idPrefix}-${c.id.replace(/[^\w-]/g, "_")}`;
        return (
          <div key={c.id} id={panelId} hidden={open !== c.id} className="mt-2 rounded-xl border border-line bg-mist/60 p-3">
            <p className="text-[13px] font-semibold text-ink">
              {c.group} · {c.heading}
            </p>
            <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-brand pl-3 text-sm text-ink-2">{c.quote ?? c.text}</blockquote>
            {c.quote && c.quote !== c.text && (
              <details className="mt-2 text-[13px] text-muted">
                <summary className="flex min-h-10 cursor-pointer items-center font-medium text-brand">Show the whole clause</summary>
                <p className="whitespace-pre-wrap text-sm text-ink-2">{c.text}</p>
              </details>
            )}
            <p className="mt-1 font-mono text-[13px] text-subtle">{c.id}</p>
          </div>
        );
      })}
    </div>
  );
}

function Statements({ statements, idPrefix }: { statements: CheckedStatement[]; idPrefix: string }) {
  return (
    <ul className="space-y-3">
      {statements.map((s, i) => (
        <li key={i} className="text-sm leading-relaxed text-ink">
          {s.text}
          <CitationChips citations={s.citations} idPrefix={`${idPrefix}-${i}`} />
        </li>
      ))}
    </ul>
  );
}

function ClauseList({ clauses }: { clauses: ClauseLite[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-white">
      {clauses.map((c) => (
        <li key={c.id}>
          <details className="group/clause px-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open/clause:rotate-180" />
              <span className="min-w-0 flex-1">{c.heading}</span>
            </summary>
            <div className="pb-3 pl-6">
              <p className="whitespace-pre-wrap text-sm text-ink-2">{c.text}</p>
              <p className="mt-1 font-mono text-[13px] text-subtle">{c.id}</p>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function PolicyExplainer({
  policyId,
  policyRef,
  groups,
  initialSummary,
  aiAvailable,
  handoff,
  isDemo,
  wordingUrl,
}: {
  policyId: string;
  policyRef: string;
  groups: { group: string; clauses: ClauseLite[] }[];
  initialSummary: ExplainerSummaryView | null;
  aiAvailable: boolean;
  handoff: ExplainerHandoffView;
  isDemo: boolean;
  wordingUrl: string | null;
}) {
  const uid = React.useId();
  const [summary, setSummary] = React.useState<ExplainerSummaryView | null>(initialSummary);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState("");
  const [asking, setAsking] = React.useState(false);
  const [result, setResult] = React.useState<AskResult | null>(null);
  const [askError, setAskError] = React.useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ threadHref: string; brokerName: string } | null>(null);
  const [handoffError, setHandoffError] = React.useState<string | null>(null);
  const resultRef = React.useRef<HTMLDivElement>(null);
  const clauseCount = groups.reduce((n, g) => n + g.clauses.length, 0);

  // Generate the cached summary once (first view of this wording version), then it is served from the cache.
  React.useEffect(() => {
    if (summary || !aiAvailable) return;
    let cancelled = false;
    callExplain<{ summary: ExplainerSummaryView }>(policyId, { action: "summary" })
      .then((d) => !cancelled && setSummary(d.summary))
      .catch((e: Error) => !cancelled && setSummaryError(e.message));
    return () => {
      cancelled = true;
    };
  }, [policyId, aiAvailable, summary]);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3 || asking) return;
    setAsking(true);
    setAskError(null);
    setHandoffOpen(false);
    setSent(null);
    setHandoffError(null);
    try {
      const r = await callExplain<AskResult>(policyId, { action: "ask", question: q });
      setResult(r);
      setQuestion("");
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  const shownClauses: ClauseLite[] = React.useMemo(() => {
    if (!result) return [];
    const seen = new Map<string, ClauseLite>();
    for (const s of result.statements) for (const c of s.citations) if (!seen.has(c.id)) seen.set(c.id, c);
    for (const m of result.matches) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()];
  }, [result]);

  async function sendToBroker() {
    if (!result || sending) return;
    setSending(true);
    setHandoffError(null);
    try {
      const d = await callExplain<{ threadHref: string; brokerName: string }>(policyId, {
        action: "handoff",
        question: result.question,
        clauseIds: shownClauses.map((c) => c.id).slice(0, 12),
        ...(result.logId ? { logId: result.logId } : {}),
      });
      setSent(d);
      setHandoffOpen(false);
    } catch (e) {
      setHandoffError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const offerBroker = !!result && (result.advisory || result.status === "not_in_wording");
  const brokerName = handoff.brokerName ?? "your broker";

  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-card border border-line bg-white">
      <header className="flex flex-wrap items-start gap-3 border-b border-line p-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-mint text-brand">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${uid}-h`} className="text-lg font-semibold text-ink">
            Explain my policy
          </h2>
          <p className="text-sm text-muted">Plain-language answers from your own schedule and wording, with the clause each answer comes from.</p>
        </div>
        {isDemo && (
          <span className="rounded-md bg-amber-bg px-2 py-1 text-[13px] font-semibold uppercase tracking-wide text-amber" title="Demo data: illustrative wording, not a real policy">
            Demo
          </span>
        )}
      </header>

      <div className="space-y-6 p-4 sm:p-5">
        <Notice tone="info">{EXPLAINER_DISCLAIMER}</Notice>

        {/* Your cover in plain words */}
        <div aria-labelledby={`${uid}-sum`}>
          <h3 id={`${uid}-sum`} className="font-semibold text-ink">
            Your cover in plain words
          </h3>
          {summary ? (
            <div className="mt-2">
              {summary.statements.length ? <Statements statements={summary.statements} idPrefix={`${uid}-s`} /> : <p className="text-sm text-muted">There isn&apos;t enough wording here to summarise. Browse the clauses below or ask your broker.</p>}
              <p className="mt-3 text-[13px] text-subtle">{summary.aiAssisted ? `${summary.label} Generated from your policy wording.` : `${summary.label} — written answers aren't available here at the moment.`}</p>
            </div>
          ) : summaryError ? (
            <p className="mt-2 text-sm text-muted">We couldn&apos;t prepare the summary just now. The clauses below are your policy wording.</p>
          ) : (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner className="size-4" /> Preparing your summary…
            </p>
          )}
        </div>

        {/* Ask */}
        <div>
          <h3 className="font-semibold text-ink">Ask about this policy</h3>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Suggested questions">
            {EXPLAINER_SUGGESTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={asking}
                  onClick={() => void ask(s.question)}
                  className="inline-flex min-h-10 items-center rounded-full border border-line px-3.5 text-sm font-medium text-brand-deep hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  {s.question}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor={`${uid}-q`} className="sr-only">
              Your question about this policy
            </label>
            <textarea
              id={`${uid}-q`}
              rows={2}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              placeholder="For example: is my windscreen covered?"
              className="min-h-12 flex-1 resize-y rounded-field border border-line px-3.5 py-2.5 text-base text-ink placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <Button type="submit" size="md" loading={asking} disabled={question.trim().length < 3} aria-label="Ask">
              {!asking && <Send aria-hidden className="size-4" />}
              <span className="hidden sm:inline">Ask</span>
            </Button>
          </form>
          {askError && (
            <p role="alert" className="mt-2 rounded-xl bg-amber-bg px-3 py-2 text-sm text-amber">
              {askError}
            </p>
          )}

          <div ref={resultRef} tabIndex={-1} aria-live="polite" className="mt-4 outline-none">
            {asking && (
              <p className="inline-flex items-center gap-2 text-sm text-muted" role="status">
                <Spinner className="size-4" /> Reading your policy…
              </p>
            )}
            {result && !asking && (
              <div className="rounded-xl border border-line p-4">
                <p className="text-[13px] font-medium uppercase tracking-wide text-muted">You asked</p>
                <p className="mt-0.5 text-sm font-medium text-ink">{result.question}</p>
                {result.notice && (
                  <Notice tone={result.advisory ? "wait" : "neutral"} className="mt-3">
                    {result.notice}
                  </Notice>
                )}
                {result.statements.length > 0 && (
                  <div className="mt-3">
                    <Statements statements={result.statements} idPrefix={`${uid}-a`} />
                  </div>
                )}
                {result.matches.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-ink">{result.mode === "ai" ? "Clauses that may be related" : "Parts of your wording that mention this"}</p>
                    <div className="mt-2">
                      <ClauseList clauses={result.matches} />
                    </div>
                  </div>
                )}
                {result.label && <p className="mt-3 text-[13px] text-subtle">{result.label}</p>}

                <div className="mt-4 border-t border-line pt-4">
                  {sent ? (
                    <Notice tone="ok" title={`Sent to ${sent.brokerName}`}>
                      Your question and the clauses you were shown are on your message thread.{" "}
                      <Link href={sent.threadHref} className="font-medium underline">
                        Open messages
                      </Link>
                    </Notice>
                  ) : handoff.available ? (
                    <>
                      {offerBroker && <p className="mb-2 text-sm text-ink-2">{result.advisory ? `Only ${brokerName} can advise on this.` : `${brokerName} can check the full wording with the insurer.`}</p>}
                      {!handoffOpen ? (
                        <Button type="button" variant={offerBroker ? "primary" : "outline"} size="sm" onClick={() => setHandoffOpen(true)}>
                          <MessageSquare aria-hidden className="size-4" /> Ask your broker
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm text-ink-2">This message goes to {brokerName} on your request thread:</p>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-mist p-3 font-sans text-[13px] text-ink-2">
                            {buildHandoffMessage({ question: result.question, policyRef, clauses: shownClauses, reasons: result.reasons })}
                          </pre>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" loading={sending} onClick={() => void sendToBroker()}>
                              Send to {brokerName}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setHandoffOpen(false)}>
                              Cancel
                            </Button>
                          </div>
                          {handoffError && (
                            <p role="alert" className="text-sm text-danger">
                              {handoffError}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted">{handoff.reason}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clause browser */}
        <details className="group/browser rounded-xl border border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <BookOpen aria-hidden className="size-4 text-brand" />
            <span className="flex-1">Browse your wording ({clauseCount} {clauseCount === 1 ? "clause" : "clauses"})</span>
            <ChevronDown aria-hidden className="size-4 text-muted transition-transform group-open/browser:rotate-180" />
          </summary>
          <div className="space-y-4 px-4 pb-4">
            {groups.map((g) => (
              <div key={g.group}>
                <h4 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">{g.group}</h4>
                <ClauseList clauses={g.clauses} />
              </div>
            ))}
            {wordingUrl && (
              <a href={wordingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
                Full policy wording from the insurer
              </a>
            )}
            <p className="text-[13px] text-subtle">These clauses are taken from your schedule, the product wording and your issued documents. If anything differs, your policy documents decide.</p>
          </div>
        </details>

        {!aiAvailable && !result && handoff.available && (
          <p className="text-sm text-muted">
            Questions about whether you&apos;re covered for something specific?{" "}
            <Link href={handoff.threadHref!} className="font-medium text-brand hover:underline">
              Message {brokerName}
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}
