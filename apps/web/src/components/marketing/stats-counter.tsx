"use client";

import * as React from "react";
import { usePrefersReducedMotion } from "./reveal";

export interface StatItem { id: string; value: number; suffix: string; label: string; note: string }

/**
 * Stats counter with a count-up animation that starts when scrolled into view (IntersectionObserver)
 * and is skipped entirely when the user prefers reduced motion. Final values render on the server so
 * the numbers are visible without JavaScript.
 */
export function StatsCounter({ items }: { items: readonly StatItem[] }) {
  const ref = React.useRef<HTMLDListElement>(null);
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = React.useState(1); // 1 = final values (SSR, no-JS, reduced motion)
  const started = React.useRef(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || started.current) return;
      started.current = true;
      io.disconnect();
      const duration = 1100;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setProgress(eased);
        if (t < 1) requestAnimationFrame(tick);
      };
      setProgress(0);
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <dl ref={ref} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((s) => (
        <div key={s.id} className="rounded-card border border-line bg-white p-5 sm:p-6">
          <dd className="font-display text-[40px] leading-none text-ink sm:text-[48px]">
            <span className="tabular-nums">{Math.round(s.value * progress)}</span>
            <span className="text-[24px] text-brand sm:text-[28px]">{s.suffix}</span>
          </dd>
          <dt className="mt-3 text-[15px] font-semibold text-ink">{s.label}</dt>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.note}</p>
        </div>
      ))}
    </dl>
  );
}
