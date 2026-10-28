/**
 * Home hero carousel rules (marketing site). Pure functions so the timing and the category picker's
 * preselection can be unit-tested without a browser.
 *
 * - Slides advance every HERO_SLIDE_MS and cross-fade over HERO_FADE_MS.
 * - Autoplay runs only when nothing asks it to stop: the visitor pressed Pause, prefers reduced motion,
 *   is hovering or has keyboard focus inside the hero, or the tab is hidden (WCAG 2.2.2).
 * - The cover picker follows the slide's suggested category until the visitor picks one themselves;
 *   after that the visitor's choice wins on every slide.
 */

export const HERO_SLIDE_MS = 7000;
export const HERO_FADE_MS = 1200;

/** Index of the slide `step` places away from `current`, wrapping in both directions. */
export function heroSlideIndex(current: number, count: number, step = 1): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const n = Math.trunc(count);
  const i = Number.isFinite(current) ? Math.trunc(current) : 0;
  const s = Number.isFinite(step) ? Math.trunc(step) : 0;
  return (((i + s) % n) + n) % n;
}

export interface HeroAutoplayState {
  /** The visitor pressed Pause. */
  paused: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** Pointer over the hero. */
  hovering: boolean;
  /** Keyboard focus inside the hero. */
  focusWithin: boolean;
  /** `document.visibilityState === "hidden"`. */
  hidden: boolean;
  /** Number of slides; one slide never rotates. */
  count: number;
}

/** True when the carousel may advance on its own right now. */
export function heroShouldAutoplay(s: HeroAutoplayState): boolean {
  return s.count > 1 && !s.paused && !s.reducedMotion && !s.hovering && !s.focusWithin && !s.hidden;
}

/**
 * The category the picker shows: the visitor's own choice once they have made one, otherwise the
 * active slide's suggestion (falling back to `fallback` when the slide suggests nothing allowed).
 */
export function heroPickerCategory<T extends string>(opts: {
  slideCategory: T | null | undefined;
  visitorChoice: T | null | undefined;
  allowed: readonly T[];
  fallback: T;
}): T {
  const { slideCategory, visitorChoice, allowed, fallback } = opts;
  if (visitorChoice && allowed.includes(visitorChoice)) return visitorChoice;
  if (slideCategory && allowed.includes(slideCategory)) return slideCategory;
  return fallback;
}

