import * as React from "react";
import clsx from "clsx";

/**
 * Covva brand lockups (brand guidelines v1.0, "Canopy C").
 * Renders the SUPPLIED artwork files unchanged from `/brand/*` (each app copies
 * `packages/tokens/brand/` into `public/brand/`). Never retype or redraw the logo.
 */
export const BRAND = {
  name: "Covva",
  tagline: "Insurance made clearer. Human help built in.",
  colours: { teal: "#00796E", ink: "#15343E", gold: "#D9B36A", forest: "#0F514D", slate: "#486068", mint: "#DCEEE4", mist: "#F1F7F3", cream: "#FFF0D6" },
  assets: {
    horizontal: "/brand/horizontal.svg",
    horizontalReverse: "/brand/horizontal-reverse.svg",
    stacked: "/brand/stacked.svg",
    mark: "/brand/mark.svg",
    wordmark: "/brand/wordmark.svg",
    pngHorizontal: "/brand/horizontal-light.png",
    pngHorizontalReverse: "/brand/horizontal-reverse-light.png",
    pngMark: "/brand/mark-transparent.png",
  },
} as const;

/** Intrinsic aspect ratios of the supplied files (width / height). */
const RATIO = { horizontal: 304 / 100, stacked: 160 / 184, mark: 1, wordmark: 207 / 96 } as const;

export interface CanopyMarkProps { size?: number; className?: string; title?: string }

/** The Canopy C on its own (app icon, avatar, compact headers). Minimum 20px. */
export function CanopyMark({ size = 32, className, title = "Covva" }: CanopyMarkProps) {
  return <img src={BRAND.assets.mark} width={size} height={size} alt={title} className={clsx("shrink-0 select-none", className)} draggable={false} />;
}

/** @deprecated use CanopyMark */
export const LogoMark = CanopyMark;

export interface LogoProps {
  variant?: "horizontal" | "stacked" | "wordmark" | "mark";
  /** Rendered height in px (for `stacked`, the width). */
  height?: number;
  /** Reverse lockup for teal backgrounds (horizontal only). */
  reverse?: boolean;
  className?: string;
  label?: string;
  /** Backwards-compatible aliases. */
  name?: string;
  size?: number;
  suffix?: React.ReactNode;
}

export function Logo({ variant = "horizontal", height, size, reverse, className, label = "Covva", suffix }: LogoProps) {
  const h = height ?? size ?? 32;
  let img: React.ReactNode;
  if (variant === "mark") {
    img = <CanopyMark size={h} title={label} />;
  } else if (variant === "wordmark") {
    img = <img src={BRAND.assets.wordmark} height={h} width={Math.round(h * RATIO.wordmark)} alt={label} draggable={false} />;
  } else if (variant === "stacked") {
    img = <img src={BRAND.assets.stacked} width={h} height={Math.round(h / RATIO.stacked)} alt={label} draggable={false} />;
  } else {
    // Horizontal lockup; the file includes the guide's clear space. Minimum width 96px.
    const w = Math.max(96, Math.round(h * RATIO.horizontal));
    img = <img src={reverse ? BRAND.assets.horizontalReverse : BRAND.assets.horizontal} height={h} width={w} alt={label} draggable={false} />;
  }
  return (
    <span className={clsx("inline-flex items-center gap-2.5 select-none", className)}>
      {img}
      {suffix}
    </span>
  );
}
