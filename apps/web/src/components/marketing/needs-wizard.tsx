"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Info, RotateCcw, UserRoundCheck } from "lucide-react";
import { Button, Notice, Pill, buttonClass, cn } from "@im/ui";
import { CATEGORY_AVAILABILITY, NEEDS_QUESTIONS, assessNeeds, humanize, type NeedsAnswers } from "@im/core";
import { CategoryIcon } from "./category-icon";
import { useIsClient } from "./reveal";

export interface WizardCategory {
  slug: string;
  name: string;
  icon: string | null;
  availability: keyof typeof CATEGORY_AVAILABILITY;
}

const STORAGE_KEY = "im:needs:v1";
const PRIORITY = {
  essential: { label: "Essential", tone: "ok" as const },
  recommended: { label: "Recommended", tone: "info" as const },
  consider: { label: "Worth considering", tone: "neutral" as const },
};

interface Saved { answers: NeedsAnswers; step: number; done: boolean }

function load(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    return v && typeof v === "object" && v.answers ? v : null;
  } catch {
    return null;
  }
}

function save(v: Saved) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode) — the wizard still works */
  }
}

/**
 * Public "Help me choose" needs assessment. Runs entirely in the browser using
 * `assessNeeds()` from @im/core; answers are kept in sessionStorage so people can resume.
 * The server renders a fresh wizard; after hydration the inner wizard is remounted once with the
 * saved answers as its initial state (no setState inside effects).
 */
export function NeedsWizard({ categories }: { categories: WizardCategory[] }) {
  const isClient = useIsClient();
  const saved = isClient ? load() : null;
  const initial = saved && Object.keys(saved.answers).length > 0 ? saved : null;
  return <WizardInner key={isClient ? "client" : "server"} categories={categories} initial={initial} hydrated={isClient} />;
}

function WizardInner({ categories, initial, hydrated }: { categories: WizardCategory[]; initial: Saved | null; hydrated: boolean }) {
  const total = NEEDS_QUESTIONS.length;
  const [answers, setAnswers] = React.useState<NeedsAnswers>(() => initial?.answers ?? {});
  const [step, setStep] = React.useState(() => (initial ? Math.min(Math.max(0, initial.step), total - 1) : 0));
  const [done, setDone] = React.useState(() => initial?.done ?? false);
  const [resumed, setResumed] = React.useState(() => !!initial);
  const [autoAdvance, setAutoAdvance] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstRender = React.useRef(true);

  // Use the captured question index so a concurrent Continue click cannot advance twice.
  // Short pause after a single-choice answer so the selection is visible before moving on.
  React.useEffect(() => {
    if (!autoAdvance) return;
    const t = window.setTimeout(() => {
      setAutoAdvance(false);
      if (step >= total - 1) setDone(true);
      else setStep(step + 1);
    }, 220);
    return () => window.clearTimeout(t);
  }, [autoAdvance, step, total]);

  React.useEffect(() => {
    if (!hydrated) return;
    save({ answers, step, done });
  }, [answers, step, done, hydrated]);

  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [step, done]);

  const q = NEEDS_QUESTIONS[step]!;
  const value = answers[q.key];

  const goTo = (n: number) => {
    setAutoAdvance(false);
    setDone(false);
    setStep(Math.min(Math.max(0, n), total - 1));
  };
  const next = () => {
    setAutoAdvance(false);
    if (step >= total - 1) setDone(true);
    else setStep(step + 1);
  };
  const choose = (v: string | boolean) => {
    setAnswers((a) => ({ ...a, [q.key]: v }));
    setAutoAdvance(true);
  };
  const toggle = (v: string) => {
    setAnswers((a) => {
      const cur = new Set(Array.isArray(a[q.key]) ? (a[q.key] as string[]) : []);
      if (v === "none") return { ...a, [q.key]: cur.has("none") ? [] : ["none"] };
      cur.delete("none");
      if (cur.has(v)) cur.delete(v);
      else cur.add(v);
      return { ...a, [q.key]: [...cur] };
    });
  };
  const reset = () => {
    setAutoAdvance(false);
    setAnswers({});
    setStep(0);
    setDone(false);
    setResumed(false);
  };

  const answered = (k: string) => {
    const v = answers[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  };
  const progress = done ? 100 : Math.round((step / total) * 100);

  if (done) return <Results answers={answers} categories={categories} onEdit={goTo} onReset={reset} headingRef={headingRef} />;

  return (
    <div className="mx-auto max-w-2xl">
      {resumed && (
        <Notice tone="info" icon={<RotateCcw className="size-4" />} className="mb-6">
          Welcome back — we kept your answers on this device.{" "}
          <button type="button" onClick={reset} className="font-semibold underline underline-offset-2">Start again</button>
        </Notice>
      )}

      <div className="flex items-center justify-between text-sm text-muted">
        <p aria-live="polite">
          Question <span className="font-semibold tabular-nums text-ink">{step + 1}</span> of {total}
        </p>
        {step > 0 && (
          <button type="button" onClick={() => goTo(step - 1)} className="inline-flex items-center gap-1 rounded font-medium text-ink-2 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <ArrowLeft aria-hidden className="size-4" /> Back
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-mint-2"
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.max(progress, 4)}%` }} />
      </div>

      <fieldset key={q.key} className="mt-8 motion-safe:animate-fade-up">
        <legend className="sr-only">{q.question}</legend>
        <h2 ref={headingRef} tabIndex={-1} className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink focus:outline-none sm:text-[34px]">
          {q.question}
        </h2>
        {q.help && <p className="mt-2 text-[15px] text-muted">{q.help}</p>}
        {q.type === "multi" && <p className="mt-2 text-[15px] text-muted">Choose all that apply.</p>}

        <div className={cn("mt-7 grid gap-3", q.type === "boolean" ? "grid-cols-2" : "sm:grid-cols-2")}>
          {q.type === "boolean" &&
            [
              { v: true, label: "Yes" },
              { v: false, label: "No" },
            ].map((o) => (
              <OptionButton key={o.label} selected={value === o.v} onClick={() => choose(o.v)} center>
                {o.label}
              </OptionButton>
            ))}
          {q.type === "single" &&
            q.options?.map((o) => (
              <OptionButton key={o.value} selected={value === o.value} onClick={() => choose(o.value)}>
                {o.label}
              </OptionButton>
            ))}
          {q.type === "multi" &&
            q.options?.map((o) => {
              const checked = Array.isArray(value) && value.includes(o.value);
              return (
                <label
                  key={o.value}
                  className={cn(
                    "flex min-h-[60px] cursor-pointer items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-[16px] font-medium transition-colors",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
                    checked ? "border-brand bg-mist text-ink" : "border-line text-ink-2 hover:border-brand/50",
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(o.value)} />
                  <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-md border-2", checked ? "border-brand bg-brand text-white" : "border-line")}>
                    {checked && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  {o.label}
                </label>
              );
            })}
        </div>
      </fieldset>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={next} className="rounded text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          Skip this question
        </button>
        {(q.type === "multi" || answered(q.key)) && (
          <Button size="lg" onClick={next}>
            {step === total - 1 ? "See suggestions" : "Continue"}
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function OptionButton({ selected, onClick, children, center }: { selected: boolean; onClick: () => void; children: React.ReactNode; center?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-[60px] w-full items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left text-[16px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        center && "justify-center text-center",
        selected ? "border-brand bg-mist text-ink" : "border-line text-ink-2 hover:border-brand/50",
      )}
    >
      {!center && (
        <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", selected ? "border-brand bg-brand text-white" : "border-line")}>
          {selected && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      )}
      {children}
    </button>
  );
}

function describe(key: string, v: NeedsAnswers[string]): string {
  const q = NEEDS_QUESTIONS.find((x) => x.key === key);
  if (v === undefined || (Array.isArray(v) && v.length === 0)) return "Skipped";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const vals = Array.isArray(v) ? v : [v];
  return vals.map((x) => q?.options?.find((o) => o.value === x)?.label ?? humanize(String(x))).join(", ");
}

function Results({
  answers,
  categories,
  onEdit,
  onReset,
  headingRef,
}: {
  answers: NeedsAnswers;
  categories: WizardCategory[];
  onEdit: (step: number) => void;
  onReset: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const result = React.useMemo(() => assessNeeds(answers), [answers]);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  return (
    <div className="grid gap-10 motion-safe:animate-fade-up lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
      <div>
        <Pill tone="ok">Your suggestions</Pill>
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-balance text-[30px] leading-[1.12] md:text-[42px] text-ink focus:outline-none">
          Here’s the cover worth considering
        </h2>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">
          Based on your answers, in order of priority — with the reasons. Start a request for any of them and your named broker will confirm what suits you.
        </p>

        {result.needsAdviser && (
          <Notice tone="wait" icon={<UserRoundCheck className="size-4" />} title="An adviser will review this with you" className="mt-6">
            {result.adviserReason}
          </Notice>
        )}

        <ol className="mt-8 space-y-4">
          {result.suggestions.map((s, i) => {
            const c = bySlug.get(s.slug);
            const availability = c?.availability ?? "planned";
            const meta = CATEGORY_AVAILABILITY[availability];
            const name = c?.name ?? humanize(s.slug.replace(/-/g, "_"));
            const canRequest = !!c && availability !== "planned";
            return (
              <li key={s.slug} className="rounded-card border border-line bg-white p-5 sm:p-6" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-start gap-4">
                  <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-mint text-brand-deep">
                    <CategoryIcon icon={c?.icon ?? s.slug} className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold tracking-tight text-ink">{name}</h3>
                      <Pill tone={PRIORITY[s.priority].tone}>{PRIORITY[s.priority].label}</Pill>
                      <Pill tone={meta.tone} className="ml-auto">{meta.label}</Pill>
                    </div>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">Why: </span>
                      {s.why}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canRequest ? (
                        <Link href={`/account/requests/new?category=${s.slug}`} className={buttonClass("primary", "sm")}>
                          Start a request <ArrowRight aria-hidden className="size-4" />
                        </Link>
                      ) : (
                        <Link href={`/contact?topic=${s.slug}`} className={buttonClass("primary", "sm")}>Register interest</Link>
                      )}
                      {c && (
                        <Link href={`/explore/${s.slug}`} className={buttonClass("secondary", "sm")}>What to compare</Link>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <Notice tone="info" icon={<Info className="size-4" />} className="mt-8">
          This is general guidance to help you think about your needs — it is not advice and not a recommendation of any product. Your broker of record reviews your needs before any application. Starting a request asks you to sign in.
        </Notice>
      </div>

      <aside aria-labelledby="answers-title" className="h-fit rounded-card border border-line bg-mist p-5 lg:sticky lg:top-24">
        <div className="flex items-center justify-between">
          <h3 id="answers-title" className="text-[20px] leading-[1.25] text-ink">Your answers</h3>
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <RotateCcw aria-hidden className="size-3.5" /> Start again
          </button>
        </div>
        <dl className="mt-4 divide-y divide-line">
          {NEEDS_QUESTIONS.map((q, i) => (
            <div key={q.key} className="py-3">
              <dt className="text-[13px] text-muted">{q.question}</dt>
              <dd className="mt-0.5 flex items-start justify-between gap-3 text-sm font-medium text-ink">
                <span>{describe(q.key, answers[q.key])}</span>
                <button type="button" onClick={() => onEdit(i)} className="shrink-0 rounded text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  Change<span className="sr-only">: {q.question}</span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-subtle">Your answers stay in this browser tab. Nothing is sent to us until you start a request.</p>
      </aside>
    </div>
  );
}
