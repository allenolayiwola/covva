"use client";

import * as React from "react";
import { cn } from "@im/ui";

const noop = () => () => {};

/** True after hydration (no setState in effects; server snapshot is false). */
export function useIsClient() {
  return React.useSyncExternalStore(noop, () => true, () => false);
}

/** True when the user prefers reduced motion (evaluated on the client only). */
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Subtle scroll-reveal wrapper. Content is always in the DOM and visible without JavaScript;
 * with JS, it slides into place once when it enters the viewport. Respects prefers-reduced-motion.
 */
export function Reveal({ children, className, delay = 0, as: As = "div" }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" }) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);
  const reduced = usePrefersReducedMotion();
  // Server HTML (and no-JS browsers) render the content fully visible; the reveal only engages after hydration.
  const isClient = useIsClient();

  React.useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const Tag = As as unknown as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      data-reveal={!isClient || reduced ? "static" : shown ? "shown" : "pending"}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        // Transform only: never hide content behind an opacity reveal (visible by default, LCP-safe, no-JS safe).
        "motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out",
        "motion-safe:data-[reveal=pending]:translate-y-3",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
