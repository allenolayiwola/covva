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
  subtle: "#6F858C",
  line: "#DCE3E1",
  mint: "#DCEEE4",
  mint2: "#E7F3ED",
  mist: "#F1F7F3",
  white: "#FFFFFF",
  amber: "#966E28",
  amberBg: "#FFF0D6",
  gold: "#D9B36A",
  danger: "#B42318",
  dangerBg: "#FEE4E2",
  info: "#1F6FB2",
  infoBg: "#E3EFFA",
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;

export const typography = {
  fontFamily: "Inter",
  display: { size: 56, lineHeight: 1.02, weight: "700", letterSpacing: -1.5 },
  h1: { size: 36, lineHeight: 1.1, weight: "700", letterSpacing: -0.8 },
  h2: { size: 26, lineHeight: 1.2, weight: "700", letterSpacing: -0.4 },
  h3: { size: 18, lineHeight: 1.3, weight: "600", letterSpacing: -0.2 },
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
