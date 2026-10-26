import { cn } from "@im/ui";
import { displayOrgName } from "./org-name";

/** WCAG relative luminance of a #rrggbb colour (0–1). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.2;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Monogram tile standing in for a partner logo (demo partners have no real logos). White initials are used only
 * where they reach 4.5:1 on the brand colour; lighter brand colours get the colour as a tint with ink initials.
 */
export function OrgTile({ name, color, size = 36, className }: { name: string; color?: string | null; size?: number; className?: string }) {
  const clean = displayOrgName(name);
  const letters = clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const bg = color || "#00796E";
  const whiteOk = (1.05) / (luminance(bg) + 0.05) >= 4.5;
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-[10px] font-semibold", whiteOk ? "text-white" : "text-ink", className)}
      style={{ width: size, height: size, fontSize: Math.max(13, Math.round(size * 0.36)), backgroundColor: whiteOk ? bg : `color-mix(in srgb, ${bg} 22%, white)` }}
    >
      {letters}
    </span>
  );
}
