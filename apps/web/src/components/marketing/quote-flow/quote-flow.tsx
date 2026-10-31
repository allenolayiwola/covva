"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Lock, Mail, Pencil, Smartphone } from "lucide-react";
import { CATEGORY_AVAILABILITY, ROLE_STATEMENTS, formatGHS, riskSchemaToZod } from "@im/core";
import { Container, Notice, Pill, Spinner, buttonClass, cn } from "@im/ui";
import { createClient } from "@/lib/supabase/client";
import { submitQuoteRequest } from "@/app/(site)/(marketing)/quote/actions";
import { track } from "../analytics";
import { CategoryIcon } from "../category-icon";
import { BrokerPicker } from "./broker-picker";
import { QuestionScreen } from "./question";
import {
  LINE_TO_CATEGORY,
  MACRO_STEPS,
  MAX_BROKERS,
  buildScreens,
  clearDraft,
  macroStep,
  readDraft,
  riskPayload,
  screenErrors,
  toFormValue,
  writeDraft,
  type FlowBroker,
  type FlowCategory,
  type Screen,
  type Value,
  type Values,
} from "./model";

const NOT_COVER = "A quote request is not cover.";

/**
 * The public quote flow (mockups 03–05): one question per screen with big tappable cards, a "Step x of 6"
 * progress bar and a sticky Back/Continue bar. Anyone can start; sign-in is asked for only before choosing
 * brokers. Answers are saved on the device and resume after sign-in (`?resume=1`).
 */
export function QuoteFlow({ categories, brokers }: { categories: FlowCategory[]; brokers: FlowBroker[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const available = React.useMemo(() => categories.filter((c) => c.availability !== "planned"), [categories]);

  const [slug, setSlug] = React.useState<string | null>(null);
  const [values, setValues] = React.useState<Values>({});
  const [brokerIds, setBrokerIds] = React.useState<string[]>([]);
  const [index, setIndex] = React.useState(0);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [booted, setBooted] = React.useState(false);
  const [user, setUser] = React.useState<"unknown" | "anonymous" | "signed_in">("unknown");
  const [submitting, startSubmit] = React.useTransition();
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const category = available.find((c) => c.slug === slug) ?? null;
  const screens = React.useMemo<Screen[]>(() => (category ? buildScreens(category.risk_schema) : [{ kind: "category" }]), [category]);
  const screen = screens[Math.min(index, screens.length - 1)]!;

  // Boot: restore the device draft, honour ?type= / ?category= / ?resume=, and find out whether the visitor is signed in.
  React.useEffect(() => {
    const draft = readDraft();
    const wanted = params.get("type") ?? params.get("category");
    const wantedSlug = wanted ? (LINE_TO_CATEGORY[wanted] ?? wanted) : null;
    const resume = params.get("resume") === "1";
    let nextSlug: string | null = null;
    let nextValues: Values = {};
    let nextBrokers: string[] = [];
    let nextIndex = 0;
    if (draft && available.some((c) => c.slug === draft.categorySlug) && (!wantedSlug || wantedSlug === draft.categorySlug)) {
      nextSlug = draft.categorySlug;
      nextValues = draft.values;
      nextBrokers = draft.brokerIds;
      nextIndex = draft.index;
    } else if (wantedSlug && available.some((c) => c.slug === wantedSlug)) {
      nextSlug = wantedSlug;
      nextIndex = 1;
    }
    if (nextSlug) {
      const cat = available.find((c) => c.slug === nextSlug)!;
      const seeded: Values = {};
      for (const f of cat.risk_schema) seeded[f.key] = toFormValue(f, nextValues[f.key] ?? paramSeed(f.key, params));
      nextValues = seeded;
      if (resume) nextIndex = buildScreens(cat.risk_schema).findIndex((s) => s.kind === "brokers");
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage / URL after hydration
    setSlug(nextSlug);
    setValues(nextValues);
    setBrokerIds(nextBrokers);
    setIndex(Math.max(0, nextIndex));
    setBooted(true);
    // depth 0: this entry was not pushed by the flow, so there is no earlier step entry to go back to.
    history.replaceState({ ...history.state, quoteStep: Math.max(0, nextIndex), quoteDepth: 0 }, "");

    createClient()
      .auth.getUser()
      .then(({ data }) => setUser(data.user ? "signed_in" : "anonymous"))
      .catch(() => setUser("anonymous"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  // Browser Back/Forward move between screens.
  React.useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const step = (e.state as { quoteStep?: number } | null)?.quoteStep;
      if (typeof step === "number") setIndex(step);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Persist the draft whenever it changes (after boot).
  React.useEffect(() => {
    if (!booted || !slug) return;
    writeDraft({ categorySlug: slug, values, brokerIds, index });
  }, [booted, slug, values, brokerIds, index]);

  // Signed-in visitors skip the sign-in screen.
  React.useEffect(() => {
    if (screen.kind === "auth" && user === "signed_in") {
      const next = screens.findIndex((s) => s.kind === "brokers");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived navigation, runs once per arrival on the auth screen
      setIndex(next);
      history.replaceState({ ...history.state, quoteStep: next }, "");
    }
  }, [screen.kind, user, screens]);

  // Move focus to the new screen's heading for keyboard and screen-reader users.
  React.useEffect(() => {
    if (booted) headingRef.current?.focus({ preventScroll: false });
  }, [index, booted]);

  const go = (next: number) => {
    setErrors({});
    setSubmitError(null);
    setIndex(next);
    const depth = ((history.state as { quoteDepth?: number } | null)?.quoteDepth ?? 0) + 1;
    history.pushState({ ...history.state, quoteStep: next, quoteDepth: depth }, "");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  /**
   * Back: use the browser history when the flow pushed the previous step; otherwise (deep link, restored
   * draft, return from sign-in) step to the previous screen explicitly, skipping sign-in when signed in.
   */
  const back = () => {
    if (index <= 0) {
      router.push("/");
      return;
    }
    if (((history.state as { quoteDepth?: number } | null)?.quoteDepth ?? 0) > 0) {
      history.back();
      return;
    }
    let prev = index - 1;
    if (screens[prev]?.kind === "auth" && user === "signed_in") prev -= 1;
    prev = Math.max(0, prev);
    setErrors({});
    setSubmitError(null);
    setIndex(prev);
    history.replaceState({ ...history.state, quoteStep: prev, quoteDepth: 0 }, "");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const pickCategory = (s: string) => {
    const cat = available.find((c) => c.slug === s)!;
    const seeded: Values = {};
    for (const f of cat.risk_schema) seeded[f.key] = toFormValue(f, values[f.key]);
    setSlug(s);
    setValues(seeded);
    track("quote_start", { category: s, placement: "quote_flow" });
    go(1);
  };

  const set = (key: string, v: Value) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const continueFromQuestion = () => {
    if (screen.kind !== "question") return;
    const errs = screenErrors(screen.fields, values);
    if (Object.keys(errs).length) {
      setErrors(errs);
      document.getElementById(`q-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    go(index + 1);
  };

  const continueFromReview = () => {
    if (!category) return;
    const res = riskSchemaToZod(category.risk_schema).safeParse(riskPayload(category.risk_schema, values));
    if (!res.success) {
      // Jump back to the first screen with a problem.
      const bad = String(res.error.issues[0]?.path[0] ?? "");
      const at = screens.findIndex((s) => s.kind === "question" && s.fields.some((f) => f.key === bad));
      if (at > 0) {
        go(at);
        setErrors({ [bad]: res.error.issues[0]?.message ?? "Please check this answer" });
      }
      return;
    }
    go(index + 1);
  };

  const send = () => {
    if (!category || !brokerIds.length || submitting) return;
    setSubmitError(null);
    startSubmit(async () => {
      const result = await submitQuoteRequest({ categorySlug: category.slug, risk: riskPayload(category.risk_schema, values), brokerIds });
      if (result.ok) {
        clearDraft();
        track("generate_lead", { kind: "customer", tag: "quote_request", page: "/quote" });
        router.push(`/account/requests/${result.requestId}?new=1`);
        return;
      }
      if (result.code === "unauthorised") {
        setUser("anonymous");
        go(screens.findIndex((s) => s.kind === "auth"));
        return;
      }
      setSubmitError(result.error);
    });
  };

  const step = macroStep(screen);
  const percent = Math.round((index / Math.max(1, screens.length)) * 100);
  const signInNext = encodeURIComponent("/quote?resume=1");

  if (!booted) {
    return (
      <Container className="py-16">
        <h1 className="sr-only">Get insurance quotes</h1>
        <div className="mx-auto flex max-w-xl items-center justify-center gap-3 text-muted"><Spinner className="size-5" /> Loading…</div>
      </Container>
    );
  }

  return (
    <div className="pb-28">
      {/* Progress */}
      <div className="border-b border-line bg-white/90 backdrop-blur">
        <Container className="py-3">
          <div className="flex items-center justify-between gap-4 text-[13px] text-muted">
            <p>
              <span className="font-semibold text-ink">Step {step} of {MACRO_STEPS.length}</span>
              <span className="hidden sm:inline"> · {MACRO_STEPS[step - 1]}</span>
              {screen.kind === "question" && <span> · question {screens.slice(0, index).filter((s) => s.kind === "question").length + 1} of {screens.filter((s) => s.kind === "question").length}</span>}
            </p>
            <p className="tabular-nums">{percent}%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-mint" role="progressbar" aria-label="Quote progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.max(4, percent)}%` }} />
          </div>
        </Container>
      </div>

      <Container className="py-8 sm:py-12">
        <div className={cn("mx-auto", screen.kind === "brokers" ? "max-w-5xl" : "max-w-2xl")}>
          {screen.kind === "category" && (
            <>
              <ScreenHeading ref={headingRef} eyebrow="Cover" title="What do you want to insure?" lede="Choose a type of cover. You can start without an account." />
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {available.map((c) => (
                  <li key={c.slug}>
                    <button
                      type="button"
                      onClick={() => pickCategory(c.slug)}
                      className={cn(
                        "flex min-h-[88px] w-full items-start gap-4 rounded-card border bg-white p-5 text-left transition-colors hover:border-brand/40 hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                        slug === c.slug ? "border-brand bg-mint/40" : "border-line",
                      )}
                    >
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-mint text-brand-deep"><CategoryIcon icon={c.icon} className="size-5" /></span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-[17px] font-semibold text-ink">
                          {c.name}
                          {c.availability !== "integrated" && <Pill tone={CATEGORY_AVAILABILITY[c.availability].tone}>{CATEGORY_AVAILABILITY[c.availability].label}</Pill>}
                        </span>
                        {c.short_description && <span className="mt-1 block text-[14px] leading-relaxed text-muted">{c.short_description}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Disclaimer />
            </>
          )}

          {screen.kind === "question" && category && (
            <>
              <ScreenHeading ref={headingRef} eyebrow={category.name} title={screen.title} lede={screen.help} />
              <div className="mt-8">
                <QuestionScreen key={index} fields={screen.fields} values={values} errors={errors} onChange={set} autoFocus={screen.fields.every((f) => !["select", "boolean", "multiselect", "region"].includes(f.type))} />
              </div>
            </>
          )}

          {screen.kind === "review" && category && (
            <>
              <ScreenHeading ref={headingRef} eyebrow="Review" title="Check your answers" lede="Your brokers use these to prepare real quotes from the insurers they represent." />
              <dl className="mt-8 divide-y divide-line rounded-card border border-line bg-white">
                <div className="flex items-center justify-between gap-4 px-5 py-4">
                  <dt className="text-sm text-muted">Cover</dt>
                  <dd className="flex items-center gap-3 text-right font-medium text-ink">
                    {category.name}
                    <button type="button" onClick={() => go(0)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] font-semibold text-brand hover:bg-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><Pencil aria-hidden className="size-3.5" /> Change</button>
                  </dd>
                </div>
                {category.risk_schema.map((f) => {
                  const v = values[f.key];
                  const shown = Array.isArray(v) ? v.map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(", ") : f.type === "boolean" ? (v === "true" ? "Yes" : v === "false" ? "No" : "") : f.type === "select" ? (f.options?.find((o) => o.value === v)?.label ?? v) : f.type === "currency" && v ? formatGHS(Number(v)) : v;
                  const at = screens.findIndex((s) => s.kind === "question" && s.fields.some((x) => x.key === f.key));
                  return (
                    <div key={f.key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <dt className="text-sm text-muted">{f.label}</dt>
                      <dd className="flex items-center gap-3 text-right text-[15px] font-medium text-ink">
                        <span>{shown || <span className="font-normal text-subtle">—</span>}</span>
                        <button type="button" onClick={() => go(at)} aria-label={`Change ${f.label}`} className="grid size-8 place-items-center rounded-full text-brand hover:bg-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><Pencil aria-hidden className="size-3.5" /></button>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <Disclaimer />
            </>
          )}

          {screen.kind === "auth" && (
            <>
              <ScreenHeading ref={headingRef} eyebrow="Sign in" title="Sign in to choose your brokers" lede="A quick code to your phone or a link to your email. Your answers are saved on this device and you will come straight back here." />
              {user === "unknown" ? (
                <div className="mt-8 flex items-center gap-3 text-muted"><Spinner className="size-5" /> Checking your session…</div>
              ) : (
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <Link href={`/sign-in?method=phone&next=${signInNext}`} className={buttonClass("primary", "lg", "w-full")}>
                    <Smartphone aria-hidden className="size-4" /> Continue with phone (+233)
                  </Link>
                  <Link href={`/sign-in?method=link&next=${signInNext}`} className={buttonClass("outline", "lg", "w-full")}>
                    <Mail aria-hidden className="size-4" /> Continue with email
                  </Link>
                </div>
              )}
              <p className="mt-6 flex items-start gap-2 text-sm text-muted"><Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" /> Why sign in? So your brokers can reach you with quotes and your request appears in your account. {ROLE_STATEMENTS.platform}</p>
            </>
          )}

          {screen.kind === "brokers" && category && (
            <>
              <ScreenHeading ref={headingRef} eyebrow="Brokers" title="Choose up to three brokers" lede="Licensed brokers prepare quotes from the insurers they represent and stay with you through claims and renewals." />
              <div className="mt-8">
                <BrokerPicker brokers={brokers} selected={brokerIds} onToggle={(id) => setBrokerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_BROKERS ? prev : [...prev, id]))} />
              </div>
              {submitError && <Notice tone="danger" className="mt-6"><span role="alert">{submitError}</span></Notice>}
              <Disclaimer />
            </>
          )}
        </div>
      </Container>

      {/* Sticky Back / Continue bar */}
      <div data-sticky-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur print:hidden">
        <Container className="flex items-center justify-between gap-3 py-3">
          <button type="button" onClick={back} className={buttonClass("outline", "md")}>
            <ArrowLeft aria-hidden className="size-4" /> Back
          </button>
          {screen.kind === "question" && (
            <button type="button" onClick={continueFromQuestion} className={buttonClass("primary", "md", "min-w-40")}>
              Continue <ArrowRight aria-hidden className="size-4" />
            </button>
          )}
          {screen.kind === "review" && (
            <button type="button" onClick={continueFromReview} className={buttonClass("primary", "md", "min-w-40")}>
              Continue <ArrowRight aria-hidden className="size-4" />
            </button>
          )}
          {screen.kind === "brokers" && (
            <button type="button" onClick={send} disabled={!brokerIds.length || submitting} className={buttonClass("primary", "md", "min-w-40")}>
              {submitting ? <><Spinner className="size-4" /> Sending…</> : <>Send to {brokerIds.length || ""} broker{brokerIds.length === 1 ? "" : "s"} <ArrowRight aria-hidden className="size-4" /></>}
            </button>
          )}
          {(screen.kind === "category" || screen.kind === "auth") && <span className="text-[13px] text-muted">{screen.kind === "category" ? "Pick a type of cover to continue" : "Sign in to continue"}</span>}
        </Container>
      </div>
    </div>
  );
}

const ScreenHeading = React.forwardRef<HTMLHeadingElement, { eyebrow: string; title: string; lede?: string }>(function ScreenHeading({ eyebrow, title, lede }, ref) {
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>
      <h1 ref={ref} tabIndex={-1} className="mt-2 text-h3 text-ink focus:outline-none">{title}</h1>
      {lede && <p className="mt-3 text-lead text-muted">{lede}</p>}
    </header>
  );
});

function Disclaimer() {
  return (
    <p className="mt-8 rounded-card border border-line bg-mist px-4 py-3 text-[13px] leading-relaxed text-ink-2">
      <strong className="font-semibold text-ink">{NOT_COVER}</strong> Quotes come from participating licensed insurers through your broker. Payment does not make cover active until the insurer accepts.
    </p>
  );
}

/** Seed answers from the hero / product-page widgets (?reg=, ?value=, ?people=, ?days=). */
function paramSeed(key: string, params: URLSearchParams): string | undefined {
  switch (key) {
    case "registration_number": return params.get("reg") ?? undefined;
    case "vehicle_value":
    case "building_value":
    case "contents_value":
    case "stock_value":
    case "sum_insured": return params.get("value") ?? undefined;
    case "members":
    case "travellers":
    case "family_members": return params.get("people") ?? undefined;
    case "trip_days": return params.get("days") ?? undefined;
    default: return undefined;
  }
}
