"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Icon button that copies a long value (an audit hash, an id) to the clipboard, so the value can be
 * shown truncated at a readable size and still be used in full. 40px tap target; announces the result.
 */
export function CopyText({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("done");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
      className="inline-grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      aria-label={state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
      title={label}
    >
      {state === "done" ? <Check aria-hidden className="size-4 text-brand" /> : <Copy aria-hidden className="size-4" />}
      <span role="status" className="sr-only">{state === "done" ? "Copied" : state === "failed" ? "Copy failed" : ""}</span>
    </button>
  );
}
