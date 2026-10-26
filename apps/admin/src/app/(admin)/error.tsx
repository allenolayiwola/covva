"use client";
import { Button, Notice } from "@im/ui";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <div className="mx-auto max-w-xl py-16">
      <Notice tone="danger" title="Something went wrong loading this page">
        <p>The error has been logged. Try again, and if it keeps happening share the reference below with engineering.</p>
        {digest && <p className="mt-2 font-mono text-xs">Reference: {digest}</p>}
      </Notice>
      <Button className="mt-4" variant="outline" size="sm" onClick={() => retry()}>Try again</Button>
    </div>
  );
}
