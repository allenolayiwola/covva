import { buttonClass } from "@im/ui";

export { buttonClass };

/** Light theme only: the former on-dark translucent button is now the outline pill. */
export function onDarkButtonClass(size: "md" | "lg" = "lg") {
  return buttonClass("outline", size);
}

/** Text link with arrow affordance. */
export const textLinkClass =
  "inline-flex items-center gap-1.5 rounded font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
