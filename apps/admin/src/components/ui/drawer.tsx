"use client";
import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@im/ui";

/**
 * Right-hand drawer whose open state lives in the URL (e.g. ?new=1 or ?id=…): the page renders it only when the
 * search params ask for it, so it survives a refresh and can be linked to.
 *
 * - Server-rendered as an open (non-modal) <dialog> so the content and its close link work without JavaScript.
 * - With JavaScript it is promoted to a modal: focus is trapped inside, the page behind is inert, Esc and a click on
 *   the backdrop close it, and focus returns to `returnFocusId` (the row link or button that opened it).
 */
export function Drawer({
  title,
  eyebrow,
  description,
  meta,
  closeHref,
  returnFocusId,
  children,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** Shown under the title (status pill, tabs…). */
  meta?: React.ReactNode;
  closeHref: string;
  returnFocusId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dialog.open && !dialog.matches(":modal")) dialog.close();
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
    return () => {
      // The drawer unmounts when the URL no longer asks for it: hand focus back to whatever opened it.
      if (!returnFocusId) return;
      requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus({ preventScroll: true }));
    };
  }, [returnFocusId]);

  function close() {
    router.push(closeHref, { scroll: false });
  }

  return (
    <dialog
      ref={ref}
      open
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className={cn(
        "fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-[560px] border-0 border-l border-line bg-white p-0 text-ink shadow-[-12px_0_32px_rgb(19_48_44/0.12)] open:flex open:flex-col",
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="mb-0.5 text-[13px] text-muted">{eyebrow}</p>}
          {/* Focus lands on the title when the drawer opens, so screen readers announce it first. */}
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-semibold leading-snug text-ink outline-none">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-0.5 text-sm text-muted">
              {description}
            </p>
          )}
          {meta && <div className="mt-2.5">{meta}</div>}
        </div>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close"
          className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-sm text-muted hover:bg-head hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand"
        >
          <X className="size-5" aria-hidden />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
    </dialog>
  );
}

/** Link-based tabs inside a drawer (each tab is its own URL). */
export function DrawerTabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav aria-label="Drawer sections" className="-mb-4 flex gap-5">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          replace
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "border-b-2 pb-2 pt-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            t.key === active ? "border-brand-deep font-semibold text-brand-deep" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
