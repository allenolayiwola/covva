"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@im/ui";
import { ALL_NAV_ITEMS } from "./nav";

/**
 * Ctrl/Cmd+K command palette: jump to any admin page, or search records by
 * reference/email (routes to the relevant list with ?q=).
 */
export function CommandPalette() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = ALL_NAV_ITEMS.filter((i) => !term || `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(term)).map((i) => ({
      key: i.href,
      label: i.label,
      hint: "Go to page",
      href: i.href,
    }));
    const searches = term
      ? [
          { key: "s-req", label: `Search requests for “${q.trim()}”`, hint: "Requests", href: `/requests?q=${encodeURIComponent(q.trim())}` },
          { key: "s-users", label: `Search users for “${q.trim()}”`, hint: "Users", href: `/users?q=${encodeURIComponent(q.trim())}` },
          { key: "s-orgs", label: `Search organisations for “${q.trim()}”`, hint: "Organisations", href: `/organisations?q=${encodeURIComponent(q.trim())}` },
          { key: "s-pol", label: `Search policies for “${q.trim()}”`, hint: "Policies", href: `/policies?q=${encodeURIComponent(q.trim())}` },
        ]
      : [];
    return [...pages, ...searches];
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function open() {
    setQ("");
    setIndex(0);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function go(href: string) {
    dialogRef.current?.close();
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="hidden h-9 w-72 items-center gap-2 rounded-[10px] border border-line bg-white px-3 text-sm text-subtle hover:border-brand/40 md:flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-line bg-mist px-1.5 text-[11px] font-medium text-muted">Ctrl K</kbd>
      </button>
      <button type="button" onClick={open} className="grid size-9 place-items-center rounded-[10px] border border-line md:hidden" aria-label="Search">
        <Search className="size-4" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        className="mx-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] rounded-card border border-line bg-white p-0 shadow-float"
        onClose={() => setQ("")}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                go(results[index]!.href);
              }
            }}
            placeholder="Type a page name, reference or email…"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
          />
          <kbd className="rounded border border-line bg-mist px-1.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(r.href)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                  i === index ? "bg-mint text-brand-deep" : "text-ink-2",
                )}
              >
                <span>{r.label}</span>
                <span className="text-xs text-subtle">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
