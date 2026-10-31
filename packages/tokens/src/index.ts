/**
 * Design tokens taken from the partnership proposal mockups.
 * Shared by web (Tailwind v4 theme.css) and the React Native mobile app.
 */
export const colors = {
  brand: "#00796E",
  brandDeep: "#0F514D",
  brandDark: "#10665E",
  ink: "#15343E",
  ink2: "#26434C",
  muted: "#486068",
  subtle: "#486068", // Slate for contrast-safe small text on white.
  line: "#DCE3E1",
  mint: "#DCEEE4",
  mint2: "#E7F3ED",
  mist: "#F1F7F3",
  white: "#FFFFFF",
  amber: "#85601F", // was #966E28 (4.1:1 on amberBg); darkened for WCAG AA small text
  amberBg: "#FFF0D6",
  gold: "#D9B36A",
  danger: "#B42318",
  dangerBg: "#FEE4E2",
  info: "#1A63A0", // was #1F6FB2; darkened for WCAG AA on infoBg
  infoBg: "#E3EFFA",
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;

export const fonts = {
  /** Display & headings — Outfit Light (300). */
  display: "Outfit",
  /** Body, UI & numbers — Inter Regular/Medium (400–500). */
  body: "Inter",
} as const;

export const brandAssets = {
  horizontal: "brand/horizontal.svg",
  horizontalReverse: "brand/horizontal-reverse.svg",
  stacked: "brand/stacked.svg",
  mark: "brand/mark.svg",
  wordmark: "brand/wordmark.svg",
  png: { horizontal: "brand/horizontal-light.png", horizontalReverse: "brand/horizontal-reverse-light.png", mark: "brand/mark-transparent.png" },
} as const;

export const typography = {
  fontFamily: "Inter",
  displayFamily: "Outfit",
  display: { size: 60, lineHeight: 1.06, weight: "300", letterSpacing: -1 },
  h1: { size: 36, lineHeight: 1.1, weight: "300", letterSpacing: -0.5 },
  h2: { size: 42, lineHeight: 1.12, weight: "300", letterSpacing: -0.3 },
  h3: { size: 24, lineHeight: 1.25, weight: "300", letterSpacing: -0.1 },
  body: { size: 16, lineHeight: 1.5, weight: "400", letterSpacing: 0 },
  small: { size: 14, lineHeight: 1.45, weight: "400", letterSpacing: 0 },
  caption: { size: 12, lineHeight: 1.4, weight: "500", letterSpacing: 0.6 },
} as const;

/** Status pill tones used across web and mobile. */
export const tones = {
  ok: { fg: colors.brandDark, bg: colors.mint },
  wait: { fg: colors.amber, bg: colors.amberBg },
  neutral: { fg: colors.muted, bg: "#EEF2F1" },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  info: { fg: colors.info, bg: colors.infoBg },
} as const;
export type Tone = keyof typeof tones;
