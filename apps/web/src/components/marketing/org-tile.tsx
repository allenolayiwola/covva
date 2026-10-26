import { cn } from "@im/ui";
import { displayOrgName } from "./brand";

/** Monogram tile standing in for a partner logo (demo partners have no real logos). */
export function OrgTile({ name, color, size = 36, className }: { name: string; color?: string | null; size?: number; className?: string }) {
  const clean = displayOrgName(name);
  const letters = clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-[10px] font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), backgroundColor: color || "#00796E" }}
    >
      {letters}
    </span>
  );
}
