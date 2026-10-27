"use client";

import * as React from "react";
import { cn } from "@im/ui";

export interface DetailTab { key: string; label: string; content: React.ReactNode }

/** Accessible tab set (Cover / Exclusions / Conditions on the quote detail page). Arrow keys move between tabs. */
export function DetailTabs({ tabs, defaultKey, className }: { tabs: DetailTab[]; defaultKey?: string; className?: string }) {
  const [active, setActive] = React.useState(defaultKey ?? tabs[0]?.key ?? "");
  const uid = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(tabs[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label="Quote details" className="flex gap-1 overflow-x-auto rounded-full bg-mist p-1">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${uid}-tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`${uid}-panel-${t.key}`}
            tabIndex={active === t.key ? 0 : -1}
            onClick={() => setActive(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "h-10 flex-1 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active === t.key ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${uid}-panel-${t.key}`} aria-labelledby={`${uid}-tab-${t.key}`} hidden={active !== t.key} className="mt-5">
          {t.content}
        </div>
      ))}
    </div>
  );
}
