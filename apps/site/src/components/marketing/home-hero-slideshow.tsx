"use client";

import * as React from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import { HERO_FADE_MS, HERO_SLIDE_MS, heroPickerCategory, heroShouldAutoplay, heroSlideIndex } from "@/lib/hero-slideshow";
import { buttonClass, cn, containerClass } from "@im/ui";
import { HOME_HERO, HOME_HERO_CHIPS, type HeroLine, type HomeHeroSlide } from "./home-hero-content";

export interface SlideMedia {
  /** Tablet and up (768px+): eager; slide 1 at high priority. */
  desktop: React.ImgHTMLAttributes<HTMLImageElement>;
  /** Phones (up to 767px): the lazy-loaded portrait crop. */
  mobile: React.ImgHTMLAttributes<HTMLImageElement>;
}

const LINES: HeroLine[] = HOME_HERO_CHIPS.map((c) => c.line);
const CREAM = "#F6E9D5";
/** A 1×1 transparent GIF: the <picture> source at the breakpoint an image is not for, so that file is never fetched. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const noop = () => () => {};

function useMediaQuery(query: string) {
  const subscribe = React.useCallback((cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  }, [query]);
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function subscribeLoad(cb: () => void) {
  window.addEventListener("load", cb);
  return () => window.removeEventListener("load", cb);
}

/**
 * Home hero slideshow: one illustrated scene per cover type behind the copy, cross-fading every HERO_SLIDE_MS with
 * its own headline and lede, and preselecting its cover in the quote card until the visitor picks one.
 *
 * - Server HTML is slide 1 only (its headline is the page's single <h1>; the LCP element on phones). The other
 *   scenes mount after the page has loaded, so they never compete with the first paint.
 * - Rotation pauses on hover, keyboard focus inside the hero, a hidden tab, or the Pause button (WCAG 2.2.2).
 *   `prefers-reduced-motion: reduce` = no autoplay and instant swaps; the slide buttons still work.
 * - Later headlines are visual only (aria-hidden) and rotations are not announced.
 * - Without JavaScript it is a static hero whose radios and GET form still work.
 */
export function HomeHeroSlideshow({ slides, media }: { slides: readonly HomeHeroSlide[]; media: SlideMedia[] }) {
  const count = slides.length;
  const [active, setActive] = React.useState(0);
  const [paused, setPaused] = React.useState<boolean | null>(null);
  const [hovering, setHovering] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [choice, setChoice] = React.useState<HeroLine | null>(null);
  // The other scenes mount once the page has finished loading (keeps them off the critical path).
  const mediaReady = React.useSyncExternalStore(subscribeLoad, () => document.readyState === "complete", () => false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const hidden = React.useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "hidden", () => false);
  const hydrated = React.useSyncExternalStore(noop, () => true, () => false);

  const motionOff = reducedMotion && paused === null;
  const playIntent = paused === null ? !reducedMotion : !paused;
  const running = hydrated && mediaReady && heroShouldAutoplay({ paused: !playIntent, reducedMotion: motionOff, hovering, focusWithin, hidden, count });

  React.useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setActive((i) => heroSlideIndex(i, count)), HERO_SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [running, active, count]);

  const selected = heroPickerCategory({ slideCategory: slides[active]?.line, visitorChoice: choice, allowed: LINES, fallback: "motor" });
  const fade = reducedMotion ? "duration-0" : "transition-[opacity,transform] ease-out";
  const fadeStyle = { transitionDuration: reducedMotion ? "0ms" : `${HERO_FADE_MS}ms` };

  return (
    <section
      aria-labelledby="home-hero-title"
      aria-roledescription="carousel"
      className="relative isolate overflow-hidden"
      style={{ backgroundColor: CREAM }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false); }}
    >
      <div className={cn(containerClass, "relative z-10 pb-6 pt-10 md:flex md:min-h-[700px] md:items-center md:py-14 wide:min-h-[760px]")}>
        <div className="min-w-0 md:max-w-[540px]">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#0d4a43]/15 bg-white/80 px-3 py-1 text-[13px] font-medium text-[#0d4a43]">
            <span aria-hidden className="size-2 rounded-full bg-brand" />
            {HOME_HERO.badge}
          </p>

          {/* Headlines and ledes share one grid cell, so the tallest sets the height and nothing shifts. */}
          <div className="mt-5 grid">
            {slides.map((s, i) => {
              const Tag = i === 0 ? "h1" : "p";
              return (
                <Tag
                  key={s.id}
                  id={i === 0 ? "home-hero-title" : undefined}
                  aria-hidden={i === 0 ? undefined : true}
                  className={cn("hero-title [grid-area:1/1] whitespace-pre-line font-display text-[44px] leading-[1.02] tracking-[-.035em] text-[#0d4a43] md:text-[56px] wide:text-[66px]", fade, i === active ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0")}
                  style={fadeStyle}
                >
                  {s.headline}
                </Tag>
              );
            })}
          </div>
          <div className="mt-5 grid max-w-[460px]">
            {slides.map((s, i) => (
              <p key={s.id} aria-hidden={i === 0 ? undefined : true} className={cn("[grid-area:1/1] text-base leading-[1.65] text-ink-2 md:text-lg", fade, i === active ? "opacity-100" : "pointer-events-none opacity-0")} style={fadeStyle}>
                {s.lede}
              </p>
            ))}
          </div>

          <form action="/quote" method="get" aria-labelledby="hero-quote-title" className="hero-quote mt-7 rounded-[20px] bg-white p-5 shadow-float md:w-[520px] md:p-6">
            <fieldset>
              <legend id="hero-quote-title" className="mb-3.5 text-sm font-medium text-ink">{HOME_HERO.formTitle}</legend>
              <div className="flex flex-wrap gap-2">
                {HOME_HERO_CHIPS.map(({ line, label }) => (
                  <label key={line} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-[15px] font-medium text-ink transition-colors hover:border-ink/40 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
                    <input type="radio" name="type" value={line} checked={selected === line} onChange={() => setChoice(line)} onClick={() => setChoice(line)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button type="submit" className={buttonClass("primary", "lg", "w-full rounded-xl! sm:flex-1")}>
                <span className="hero-cta-default">Start my quote</span>
                {HOME_HERO_CHIPS.map(({ line, cta }) => (
                  <span key={line} className="hero-cta" data-line={line}>Start my {cta} quote</span>
                ))}
                <ArrowRight aria-hidden className="size-4" />
              </button>
              <p className="text-[13px] leading-[1.45] text-muted">{HOME_HERO.note[0]}<br className="hidden sm:inline" /> {HOME_HERO.note[1]}</p>
            </div>
          </form>
          <p className="mt-4 max-w-[520px] text-[13px] leading-[1.55] text-muted">A quote request is not cover. You are covered only when an insurer accepts and issues your policy.</p>

          {/* Slide controls: pick a scene, or pause the rotation. */}
          <div className="mt-5 flex items-center gap-3" role="group" aria-label="Hero slides">
            <button
              type="button"
              onClick={() => setPaused(playIntent)}
              aria-label={playIntent ? "Pause slideshow" : "Play slideshow"}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-[#0d4a43]/20 bg-white/80 text-[#0d4a43] hover:bg-white"
            >
              {playIntent ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Show slide ${i + 1} of ${count}: ${s.topic}`}
                  aria-current={i === active ? "true" : undefined}
                  className={cn("h-2 rounded-full transition-all", i === active ? "w-7 bg-[#0d4a43]" : "w-2 bg-[#0d4a43]/25 hover:bg-[#0d4a43]/50")}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Phones: the scene as a band under the quote card. Tablet and up: the right 60% of the hero, showing the painted
          half of each illustration whatever the hero height; its left edge blends into the cream. */}
      <figure className="relative h-[380px] sm:h-[480px] md:absolute md:inset-y-0 md:left-[40%] md:right-0 md:h-auto wide:left-[42%]">
        {/* Slide 1 always; a slide the visitor picks at once; the rest after the page has loaded. Each slide has one
            image per breakpoint whose <picture> resolves to BLANK at the other breakpoint, so a phone never downloads
            the wide scene (nor a laptop the phone crop) and each keeps its own loading and priority (home-hero.tsx). */}
        {slides.map((s, i) => {
          if (!(i === 0 || i === active || mediaReady)) return null;
          const imgClass = cn("absolute inset-0 size-full object-cover object-[50%_75%] md:object-right", fade, i === active ? "opacity-100" : "opacity-0", !reducedMotion && i === active ? "scale-100" : "md:scale-[1.02]");
          const shared = { "aria-hidden": i === active ? undefined : true, style: fadeStyle } as const;
          return (
            <React.Fragment key={s.id}>
              <picture>
                <source media="(max-width: 767px)" srcSet={BLANK} />
                {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
                <img {...media[i]!.desktop} {...shared} className={cn(imgClass, "hidden md:block")} />
              </picture>
              <picture>
                <source media="(min-width: 768px)" srcSet={BLANK} />
                {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
                <img {...media[i]!.mobile} {...shared} className={cn(imgClass, "block md:hidden")} />
              </picture>
            </React.Fragment>
          );
        })}
        {/* Blend the scene into the cream: from the top on phones, from the left behind the copy on larger screens. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#F6E9D5] to-transparent md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[35%] md:bg-gradient-to-r md:from-[#F6E9D5] md:to-transparent" />
        <figcaption className="absolute bottom-3 right-3 rounded-full bg-white/85 px-2.5 py-0.5 text-[12px] text-muted">Image: AI-generated</figcaption>
      </figure>
    </section>
  );
}
