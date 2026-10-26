# Covva brand — implementation notes

Source of truth: `brand-guidelines.pdf` (v1.0, October 2026) in this folder. Logo: **Canopy C** (option A).
Supplied artwork lives in `packages/tokens/brand/` and is copied unchanged into `apps/*/public/brand/`.
**Never retype or redraw the logo; always use the supplied files.**

| Use | File |
|---|---|
| Primary lockup (web header, documents) | `horizontal.svg` / `horizontal-light.png` |
| On teal backgrounds | `horizontal-reverse.svg` / `horizontal-reverse-light.png` |
| App icon, avatar, compact headers | `mark.svg` / `mark-transparent.png` |
| Stacked (splash, auth) | `stacked.svg` |
| Wordmark only | `wordmark.svg` |

Rules from the guide: clear space = ½ the mark height on all sides (built into the files); minimum width 96px for the
horizontal lockup, 20px for the mark; no stretching, recolouring, rotating, shadows or fades; never on low-contrast
backgrounds. Below 32px drop the check from the mark (use `mark.svg` at ≥32px; for smaller favicons the resized PNG is acceptable).

Web usage: `import { Logo, CanopyMark } from "@im/ui"` → `<Logo height={36} />`, `<Logo reverse />`, `<Logo variant="stacked" height={120} />`, `<CanopyMark size={40} />`.
Mobile usage: use the PNGs/SVGs from `packages/tokens/brand/` directly (e.g. `mark-transparent.png` for the app icon on Mist `#F1F7F3`).

## Colour (tokens in `packages/tokens`)
Covva Teal `#00796E` (primary, buttons, links) · Deep Ink `#15343E` (headings, wordmark) · Harvest Gold `#D9B36A`
(highlights only — never text) · Forest `#0F514D` (pressed/dark accents) · Slate `#486068` (body) · Mint `#DCEEE4`
(tints) · Mist `#F1F7F3` (page backgrounds) · Cream `#FFF0D6` (notices, placeholders).

## Type
Display & headings: **Outfit** 300–400 (`--font-display`, applied to `h1`/`h2` and `.font-display`).
Body, UI & numbers: **Inter** 300–500 (`--font-sans`). Tailwind `font-semibold`/`font-bold` map to 500 per the guide.

## Icons & imagery
Lucide icons at 1.75px rounded strokes (global CSS), teal with a single gold accent. Imagery: bright natural daylight
photography of real Ghanaian people and places; product screens always in device mockups; sample data marked "DEMO".
