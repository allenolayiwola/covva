"use client";
import { useState } from "react";
import { Button } from "@im/ui";

/** Copies the Meta Business Manager submission text for a template to the clipboard. */
export function CopyForMeta({ text, label = "Copy for Meta submission" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
