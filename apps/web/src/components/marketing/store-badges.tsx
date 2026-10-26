import { Smartphone } from "lucide-react";
import { cn } from "@im/ui";

/** Store links come from env so the badges switch from "Coming at launch" to real links without a code change. */
export const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || null;
export const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || null;

/**
 * App Store / Google Play badge components built from text and a generic icon (no third-party brand
 * artwork files). Rendered as links when the store URL is configured, otherwise as "Coming at launch".
 */
export function StoreBadge({ store, href, className, size = "md" }: { store: "apple" | "google"; href: string | null; className?: string; size?: "sm" | "md" }) {
  const name = store === "apple" ? "App Store" : "Google Play";
  const lead = store === "apple" ? "Download on the" : "Get it on";
  const base = cn(
    "inline-flex items-center gap-2.5 rounded-[12px] border font-sans",
    size === "md" ? "h-14 px-4" : "h-11 px-3",
    href ? "border-ink bg-ink text-white hover:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2" : "border-line bg-white text-muted",
    className,
  );
  const inner = (
    <>
      <Smartphone aria-hidden className={cn(size === "md" ? "size-6" : "size-5", href ? "text-white" : "text-brand")} />
      <span className="leading-tight">
        <span className={cn("block", size === "md" ? "text-[10px]" : "text-[9px]", href ? "text-white/80" : "text-muted")}>{href ? lead : "Coming at launch"}</span>
        <span className={cn("block font-semibold", size === "md" ? "text-[16px]" : "text-[14px]", href ? "text-white" : "text-ink-2")}>{name}</span>
      </span>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={base} aria-label={`${lead} ${name} (opens in a new tab)`}>
        {inner}
      </a>
    );
  }
  return (
    <span className={base} aria-label={`${name}: coming at launch`}>
      {inner}
    </span>
  );
}

export function StoreBadges({ className, size }: { className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <StoreBadge store="apple" href={APP_STORE_URL} size={size} />
      <StoreBadge store="google" href={PLAY_STORE_URL} size={size} />
    </div>
  );
}
