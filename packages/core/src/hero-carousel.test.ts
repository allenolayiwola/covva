import { test } from "node:test";
import assert from "node:assert/strict";
import { HERO_FADE_MS, HERO_SLIDE_MS, heroPickerCategory, heroShouldAutoplay, heroSlideIndex } from "./hero-carousel.ts";

test("hero timing: a slide stays long enough to read and the fade is shorter than the slide", () => {
  assert.ok(HERO_SLIDE_MS >= 5000, "at least 5 s per slide");
  assert.ok(HERO_FADE_MS < HERO_SLIDE_MS / 2);
});

test("heroSlideIndex wraps forwards and backwards", () => {
  assert.equal(heroSlideIndex(0, 4), 1);
  assert.equal(heroSlideIndex(3, 4), 0);
  assert.equal(heroSlideIndex(0, 4, -1), 3);
  assert.equal(heroSlideIndex(2, 4, -6), 0);
  assert.equal(heroSlideIndex(1, 4, 9), 2);
  assert.equal(heroSlideIndex(0, 1), 0);
});

test("heroSlideIndex is safe with empty or odd input", () => {
  assert.equal(heroSlideIndex(2, 0), 0);
  assert.equal(heroSlideIndex(Number.NaN, 4), 1);
  assert.equal(heroSlideIndex(1, 4, Number.NaN), 1);
  assert.equal(heroSlideIndex(1.7, 4.2), 2);
});

test("heroShouldAutoplay stops for pause, reduced motion, hover, focus and hidden tabs", () => {
  const base = { paused: false, reducedMotion: false, hovering: false, focusWithin: false, hidden: false, count: 4 };
  assert.equal(heroShouldAutoplay(base), true);
  for (const key of ["paused", "reducedMotion", "hovering", "focusWithin", "hidden"] as const) {
    assert.equal(heroShouldAutoplay({ ...base, [key]: true }), false, key);
  }
  assert.equal(heroShouldAutoplay({ ...base, count: 1 }), false, "a single slide never rotates");
});

test("heroPickerCategory follows the slide until the visitor chooses", () => {
  const allowed = ["motor", "home", "health", "travel", "life-funeral", "business"] as const;
  type Line = (typeof allowed)[number];
  const pick = (slideCategory: Line | null, visitorChoice: Line | null) => heroPickerCategory<Line>({ slideCategory, visitorChoice, allowed, fallback: "motor" });
  assert.equal(pick("health", null), "health");
  assert.equal(pick("motor", null), "motor");
  assert.equal(pick("motor", "travel"), "travel", "the visitor's choice wins");
  assert.equal(pick(null, null), "motor", "fallback");
  assert.equal(heroPickerCategory({ slideCategory: "pets", visitorChoice: null, allowed: ["motor", "home"], fallback: "home" }), "home", "unknown suggestion falls back");
  assert.equal(heroPickerCategory({ slideCategory: "motor", visitorChoice: "pets", allowed: ["motor", "home"], fallback: "home" }), "motor", "unknown choice is ignored");
});

