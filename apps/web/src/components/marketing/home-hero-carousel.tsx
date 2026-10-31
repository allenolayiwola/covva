"use client";

import * as React from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import { HERO_FADE_MS, HERO_SLIDE_MS, heroPickerCategory, heroShouldAutoplay, heroSlideIndex } from "@im/core";
import { buttonClass, cn, containerClass } from "@im/ui";
import { HERO_CATEGORIES, HERO_LINES, type HeroLine } from "./hero-categories";

export interface HeroCarouselSlide {
  id: string;
  topic: string;
  eyebrow: string;
  headline: string;
  accent: string;
  /** Server-rendered (slide 1 carries the `home_hero_headline` experiment). */
  subline: React.ReactNode;
  caption: string;
  category: HeroLine;
  focus: { wide: string; tall: string };
  /** Server-rendered <picture>. Slide 1 loads eagerly (LCP); the rest mount after the page has loaded. */
  media: React.ReactNode;
}

const SCROLL_SOLID_AT = 80;
const noopSubscribe = () => () => {};

function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function useDocumentHidden() {
  return React.useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "hidden", () => false);
}

/** True once hydrated (stable server snapshot `false`). */
function useHydrated() {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Home hero: a full-viewport photographic carousel behind the copy and the cover picker.
 *
 * - Cross-fades between slides (HERO_FADE_MS) with a slow Ken Burns zoom (capped at 1.05) on the image in view.
 * - Advances every HERO_SLIDE_MS, driven by the active progress bar's CSS animation, so pausing (Pause button,
 *   hover, keyboard focus inside the hero, hidden tab) freezes the bar and resumes where it stopped.
 * - `prefers-reduced-motion: reduce`: no autoplay, no zoom, instant swaps.
 * - One <h1> (slide 1's headline) stays in the accessibility tree; later slides swap the visible copy only, and
 *   rotations are not announced (no live region).
 * - The header turns transparent over the photo while the page is at the top (globals.css, `data-hero-*`).
 */
export function HomeHeroCarousel({ slides, className }: { slides: HeroCarouselSlide[]; className?: string }) {
  const count = slides.length;
  const [active, setActive] = React.useState(0);
  const [leaving, setLeaving] = React.useState<number | null>(null);
  /** null = the visitor has not pressed Pause/Play (reduced motion then means "no autoplay"). */
  const [paused, setPaused] = React.useState<boolean | null>(null);
  const [hovering, setHovering] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [visitorChoice, setVisitorChoice] = React.useState<HeroLine | null>(null);
  const [mediaReady, setMediaReady] = React.useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const hidden = useDocumentHidden();
  const hydrated = useHydrated();
  // Reduced motion turns autoplay off by default; pressing Play opts back in (still without zoom or fades).
  const motionOff = reducedMotion && paused === null;
  const playIntent = paused === null ? !reducedMotion : !paused;
  const running = hydrated && heroShouldAutoplay({ paused: !playIntent, reducedMotion: motionOff, hovering, focusWithin, hidden, count });
  const showsPlaying = playIntent && !focusWithin;
  const slide = slides[active] ?? slides[0]!;
  const selected = heroPickerCategory({ slideCategory: slide.category, visitorChoice, allowed: HERO_LINES, fallback: slides[0]?.category ?? "motor" });

  const go = (index: number) => {
    const next = heroSlideIndex(index, count, 0);
    if (next === active) return;
    setMediaReady(true);
    setLeaving(active);
    setActive(next);
  };

  // The outgoing image stays under the incoming one until the fade has finished.
  React.useEffect(() => {
    if (leaving === null) return;
    const t = window.setTimeout(() => setLeaving(null), HERO_FADE_MS + 100);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // Slides 2–4 are not on the critical path: mount their images once the page has loaded and the browser is idle.
  React.useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    const ready = () => {
      if (cancelled) return;
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idleId = ric ? ric(() => !cancelled && setMediaReady(true), { timeout: 2500 }) : window.setTimeout(() => !cancelled && setMediaReady(true), 600);
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", ready);
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idleId !== undefined) (cic ?? window.clearTimeout)(idleId);
    };
  }, []);

  // Transparent header over the photo until the visitor scrolls past SCROLL_SOLID_AT (globals.css).
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.heroSeen = "";
    root.dataset.heroActive = "";
    const onScroll = () => {
      if (window.scrollY > SCROLL_SOLID_AT) root.dataset.heroScrolled = "";
      else delete root.dataset.heroScrolled;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      delete root.dataset.heroActive;
      delete root.dataset.heroScrolled;
    };
  }, []);

  const kenBurns = hydrated && !reducedMotion;

  return (
    <section
      data-hero-overlay
      aria-labelledby="hero-title"
      aria-roledescription="carousel"
      className={cn("relative isolate -mt-16 overflow-hidden bg-neutral-950 text-white lg:-mt-[72px]", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovering(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovering(false)}
      onFocus={(e) => {
        // Keyboard focus inside the hero stops rotation (APG carousel); mouse clicks are covered by hover.
        if ((e.target as HTMLElement).matches?.(":focus-visible")) setFocusWithin(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      {/* Photographs ------------------------------------------------------------------------------- */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[min(100svh,1200px)] lg:bottom-0 lg:h-auto">
        {slides.map((s, i) => {
          const on = i === active;
          const under = i === leaving;
          const show = i === 0 || mediaReady;
          return (
            <div
              key={s.id}
              aria-hidden={on ? undefined : true}
              data-hero-media={s.id}
              className={cn(
                "absolute inset-0 overflow-hidden transition-opacity ease-in-out motion-reduce:transition-none",
                on ? "z-20 opacity-100" : under ? "z-10 opacity-100" : "z-0 opacity-0",
              )}
              style={{ transitionDuration: `${HERO_FADE_MS}ms`, ["--hero-focus-wide" as string]: s.focus.wide, ["--hero-focus-tall" as string]: s.focus.tall }}
            >
              <div className={cn("hero-photo absolute inset-0", kenBurns && (on || under) && "hero-kenburns", !playIntent && "[animation-play-state:paused]")}>
                {show ? s.media : null}
              </div>
            </div>
          );
        })}
        <div aria-hidden className="hero-scrim absolute inset-0 z-30" />
      </div>

      {/* Copy, picker, controls --------------------------------------------------------------------- */}
      <div className={cn(containerClass, "hero-grid relative min-h-[min(100svh,1200px)] pt-16 lg:min-h-[min(100svh,1100px)] lg:pt-[72px]")}>
        <div className="grid min-h-[calc(min(100svh,1200px)-7.25rem)] pb-24 [grid-area:copy] lg:min-h-0 lg:pb-0">
          {slides.map((s, i) => {
            const on = i === active;
            const hide = on ? undefined : true;
            const Headline = i === 0 ? "h1" : "p";
            return (
              <div
                key={s.id}
                aria-hidden={!on && i !== 0 ? true : undefined}
                data-hero-copy={s.id}
                className={cn(
                  "flex flex-col justify-end [grid-area:1/1] [text-shadow:0_1px_14px_rgb(0_0_0/0.28)] motion-reduce:transition-none",
                  on ? "translate-y-0 opacity-100 transition-[opacity,transform] delay-300 duration-700 ease-out" : "pointer-events-none translate-y-3 opacity-0 transition-[opacity,transform] duration-500",
                )}
              >
                <p aria-hidden={hide} className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.16em] text-white sm:text-sm">
                  <span aria-hidden className="h-px w-8 bg-gold" />
                  {s.eyebrow}
                </p>
                <Headline
                  id={i === 0 ? "hero-title" : undefined}
                  className="mt-4 font-display text-[36px] leading-[1.04] tracking-[-0.03em] text-white min-[380px]:text-[38px] sm:text-[52px] lg:mt-5 lg:text-[clamp(52px,4.3vw,80px)]"
                >
                  {s.headline}{" "}
                  <span className="block pt-1 text-[1.06em] leading-[1.02] tracking-[-0.01em] text-mint">{s.accent}</span>
                </Headline>
                <p aria-hidden={hide} className="mt-5 max-w-[34rem] text-[16px] leading-relaxed text-white sm:text-[18px] lg:mt-6 lg:text-[19px]">
                  {s.subline}
                </p>
              </div>
            );
          })}
        </div>

        {/* Slide controls: topic labels with progress bars, and Pause/Play (WCAG 2.2.2). */}
        <div className="mt-3 flex items-center gap-2 [grid-area:controls] max-lg:rounded-[2px] max-lg:bg-black/55 max-lg:p-1 max-lg:pr-4 max-lg:backdrop-blur-md sm:gap-3 lg:mt-7 lg:max-w-[560px]">
          <button
            type="button"
            onClick={() => {
              if (showsPlaying) setPaused(true);
              else {
                setPaused(false);
                setFocusWithin(false);
              }
            }}
            aria-label={showsPlaying ? "Pause slideshow" : "Play slideshow"}
            data-testid="hero-pause"
            className="grid size-10 shrink-0 place-items-center rounded-[2px] border border-white/40 bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {showsPlaying ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          </button>
          <ol className="flex min-w-0 flex-1 gap-1.5 sm:gap-2" aria-label="Choose a slide">
            {slides.map((s, i) => {
              const on = i === active;
              return (
                <li key={s.id} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`${s.topic}, slide ${i + 1} of ${count}`}
                    aria-current={on ? "true" : undefined}
                    className="group flex h-10 w-full min-w-0 flex-col justify-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className={cn("block truncate text-[13px] leading-none text-white", on ? "font-semibold" : "font-normal group-hover:underline")}>
                      {s.topic}
                    </span>
                    <span aria-hidden className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/30">
                      {on && (
                        <span
                          key={`${active}-${motionOff}`}
                          data-testid="hero-progress"
                          className={cn("absolute inset-0 origin-left rounded-full bg-white", !(hydrated && motionOff) && "hero-progress")}
                          style={{ animationDuration: `${HERO_SLIDE_MS}ms`, animationPlayState: running ? "running" : "paused" }}
                          onAnimationEnd={() => running && go(heroSlideIndex(active, count))}
                        />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Cover picker: a plain GET form, so it works before hydration and without JS. */}
        <form
          action="/quote"
          method="get"
          aria-labelledby="hero-quote-title"
          className="mb-12 w-full max-w-[560px] rounded-[2px] bg-[#FFF9EF] p-5 text-ink shadow-float [grid-area:card] sm:p-6 lg:mb-0 lg:mt-6 lg:max-w-[520px] lg:p-5"
        >
          <h2 id="hero-quote-title" className="font-display text-[20px] leading-tight text-ink sm:text-[22px]">
            What would you like to insure?
          </h2>
          <p className="mt-1 text-[13px] text-muted">Start in minutes — sign in with your phone to see quotes.</p>
          <fieldset className="mt-4">
            <legend className="sr-only">Type of cover</legend>
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {HERO_CATEGORIES.map(({ line, label, Icon }) => (
                <label
                  key={line}
                  className={cn(
                    "flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[2px] border border-line bg-white px-1 py-2 text-[14px] font-medium text-ink-2 transition-colors sm:min-h-[72px] sm:text-[15px] lg:min-h-[64px]",
                    "hover:border-brand/50 has-[:checked]:border-brand has-[:checked]:bg-mint/70 has-[:checked]:text-brand-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
                  )}
                >
                  <input
                    type="radio"
                    name="category"
                    value={line}
                    checked={selected === line}
                    onChange={() => setVisitorChoice(line)}
                    className="sr-only"
                  />
                  <Icon aria-hidden className="size-5 text-brand sm:size-6" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className={buttonClass("primary", "lg", "mt-4 w-full rounded-[2px]!")}>
            Compare quotes <ArrowRight aria-hidden className="size-4" />
          </button>
          <p className="mt-3 text-center text-[13px] leading-snug text-muted">Cover begins only after insurer acceptance and policy issuance.</p>
        </form>

        <p aria-hidden className="hidden self-end justify-self-end rounded-[2px] bg-black/55 px-4 py-1.5 font-accent text-[19px] italic text-white backdrop-blur-md [grid-area:caption] lg:block">
          {slide.caption}
        </p>
      </div>
    </section>
  );
}
