import { buttonClass } from "@im/ui";

export { buttonClass };

/** Translucent button for use on teal/ink backgrounds (avoids conflicting overrides of `buttonClass`). */
export function onDarkButtonClass(size: "md" | "lg" = "lg") {
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold text-white transition-colors",
    "bg-white/10 ring-1 ring-inset ring-white/30 hover:bg-white/20",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    size === "lg" ? "h-12 px-6 text-base" : "h-11 px-5 text-[15px]",
  ].join(" ");
}

/** Text link with arrow affordance. */
export const textLinkClass =
  "inline-flex items-center gap-1.5 rounded font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
