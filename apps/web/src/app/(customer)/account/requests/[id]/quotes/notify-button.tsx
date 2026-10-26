"use client";
import * as React from "react";
import { Bell, Check } from "lucide-react";
import { Button } from "@im/ui";
import { notifyWhenReady } from "../actions";

export function NotifyButton({ requestId, quoteId, className }: { requestId: string; quoteId: string; className?: string }) {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={pending}
        disabled={msg?.ok}
        onClick={() =>
          start(async () => {
            const res = await notifyWhenReady(requestId, quoteId);
            setMsg({ ok: res.ok, text: res.ok ? res.message ?? "We'll let you know." : res.error ?? "Something went wrong." });
          })
        }
      >
        {msg?.ok ? <Check aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
        {msg?.ok ? "We'll notify you" : "Notify me"}
      </Button>
      <p aria-live="polite" className={msg && !msg.ok ? "mt-1.5 text-xs text-danger" : "sr-only"}>{msg?.text}</p>
    </div>
  );
}
