"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@im/ui";
import type { FaqGroup } from "./content";
import { FaqList } from "./faq-list";

function normalise(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");
}

/** Client-side filter over the help-centre FAQ. All content is server-rendered first. */
export function FaqSearch({ groups }: { groups: FaqGroup[] }) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<string>("all");
  const deferred = React.useDeferredValue(query);
  const terms = normalise(deferred).split(/\s+/).filter(Boolean);

  const filtered = groups
    .filter((g) => active === "all" || g.id === active)
    .map((g) => ({
      ...g,
      items: terms.length ? g.items.filter((it) => terms.every((t) => normalise(`${it.q} ${it.a} ${g.title}`).includes(t))) : g.items,
    }))
    .filter((g) => g.items.length > 0);
  const count = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      <div className="relative">
        <label htmlFor="faq-search" className="sr-only">Search help articles</label>
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-subtle" />
        <input
          id="faq-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, e.g. “claim”, “mobile money”, “renewal”"
          autoComplete="off"
          className="block h-14 w-full rounded-2xl border border-line bg-white pl-12 pr-12 text-[16px] text-ink shadow-card placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by topic">
        {[{ id: "all", title: "All topics" }, ...groups].map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={active === g.id}
            onClick={() => setActive(g.id)}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active === g.id ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-brand hover:text-brand",
            )}
          >
            {g.title}
          </button>
        ))}
      </div>

      <p aria-live="polite" className="sr-only">
        {terms.length ? `${count} result${count === 1 ? "" : "s"}` : ""}
      </p>

      <div className="mt-10 space-y-12">
        {filtered.map((g) => (
          <section key={g.id} aria-labelledby={`faq-group-${g.id}`}>
            <h2 id={`faq-group-${g.id}`} className="mb-4 text-xl font-bold tracking-tight text-ink">{g.title}</h2>
            <FaqList items={g.items} />
          </section>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-card border border-dashed border-line bg-mist p-8 text-center">
            <p className="font-semibold text-ink">No answers match “{deferred}”.</p>
            <p className="mt-1 text-sm text-muted">Try different words, or send us a message below.</p>
          </div>
        )}
      </div>
    </div>
  );
}
