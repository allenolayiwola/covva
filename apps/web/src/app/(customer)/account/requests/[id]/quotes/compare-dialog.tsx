"use client";

import * as React from "react";
import { Columns3, X } from "lucide-react";
import { buttonClass, cn } from "@im/ui";

/**
 * "Compare all side by side" (mockup 06): a modal on desktop and a bottom sheet on phones, built on the native
 * <dialog> so focus is trapped and Escape closes it. The comparison table itself is server-rendered and passed
 * in as children.
 */
export function CompareDialog({ children, count, className }: { children: React.ReactNode; count: number; className?: string }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" onClick={open} className={cn(buttonClass("outline", "md"), className)}>
        <Columns3 aria-hidden className="size-4" /> Compare all side by side
      </button>
      <dialog
        ref={ref}
        aria-labelledby="compare-dialog-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className={cn(
          "m-0 w-full max-w-none bg-transparent p-0 backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]",
          // phones: bottom sheet; desktop: centred modal
          "fixed inset-x-0 bottom-0 top-auto max-h-[92dvh] sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[88dvh] sm:max-w-6xl sm:p-6",
        )}
      >
        <div className="flex max-h-[92dvh] flex-col overflow-hidden rounded-t-hero bg-white shadow-float sm:max-h-[80dvh] sm:rounded-hero">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <span aria-hidden className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-line sm:hidden" />
              <h2 id="compare-dialog-title" className="text-h4 text-ink">Compare {count} quotes side by side</h2>
              <p className="mt-1 text-sm text-muted">Same risk, same period. Prices from participating licensed insurers via your broker.</p>
            </div>
            <button type="button" onClick={close} aria-label="Close comparison" className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="overflow-auto px-5 py-4 sm:px-6">{children}</div>
        </div>
      </dialog>
    </>
  );
}
