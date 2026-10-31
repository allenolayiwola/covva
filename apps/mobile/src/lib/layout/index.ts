export const READING_MAX_WIDTH = 720;
export const GRID_MAX_WIDTH = 1100;
export const RAIL_BREAKPOINT = 840;
/** Navigation rail and policy list-detail use the same window-width threshold. */
export const hasRail = (width: number) => width >= RAIL_BREAKPOINT;
export const isWide = (width: number) => width >= 600;
export const contentMaxWidth = (kind: 'reading' | 'grid' = 'reading') => kind === 'grid' ? GRID_MAX_WIDTH : READING_MAX_WIDTH;
export function gridColumns(width: number, minimum = 280, gap = 24) {
  return Math.max(1, Math.floor((Math.min(width, GRID_MAX_WIDTH) + gap) / (minimum + gap)));
}

export type HorizontalRect = { x: number; width: number };
// Only pass a separating, vertical fold reported by a real platform posture API.
// TODO: integrate a posture provider when available. No such native dependency is
// installed. Window sizes (including 669/951) cannot distinguish Duo from iPad
// Split View/Stage Manager. Unknown posture means zero crease, on both platforms.
export type Fold = { x: number; width: number; separating: boolean };
export function creaseBand(fold: Fold | null): HorizontalRect | null {
  if (!fold?.separating) return null;
  const width = Math.max(40, fold.width);
  return { x: fold.x + fold.width / 2 - width / 2, width };
}
export function usablePanes(bounds: HorizontalRect, fold: Fold | null): HorizontalRect[] {
  const band = creaseBand(fold);
  const end = bounds.x + bounds.width;
  if (!band || band.x >= end || band.x + band.width <= bounds.x) return [bounds];
  return [
    { x: bounds.x, width: Math.max(0, band.x - bounds.x) },
    { x: Math.max(bounds.x, band.x + band.width), width: Math.max(0, end - Math.max(bounds.x, band.x + band.width)) },
  ].filter(pane => pane.width > 0);
}
export function readingPane(bounds: HorizontalRect, fold: Fold | null): HorizontalRect {
  return usablePanes(bounds, fold).sort((a, b) => b.width - a.width)[0] ?? { x: bounds.x, width: 0 };
}
