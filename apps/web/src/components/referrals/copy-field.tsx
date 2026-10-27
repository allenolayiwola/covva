"use client";
import * as React from "react";
import { Check, Copy, MessageCircle, MessageSquare } from "lucide-react";
import { buttonClass, cn } from "@im/ui";

/** Read-only value with a copy button (links, codes, the widget snippet). */
export function CopyField({ value, label, multiline, className }: { value: string; label: string; multiline?: boolean; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const id = React.useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the value is selectable */
    }
  };
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">{label}</label>
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea id={id} readOnly value={value} rows={3} className="min-w-0 flex-1 rounded-xl border border-line bg-mist/40 px-3 py-2 font-mono text-xs text-ink" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input id={id} readOnly value={value} className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-mist/40 px-3 font-mono text-sm text-ink" onFocus={(e) => e.currentTarget.select()} />
        )}
        <button type="button" onClick={copy} className={buttonClass("secondary", "sm")} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/** WhatsApp / SMS / copy share buttons for a referral link. */
export function ShareButtons({ url, text }: { url: string; text: string }) {
  const message = `${text} ${url}`;
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
        <MessageCircle className="size-4" aria-hidden /> Share on WhatsApp
      </a>
      <a href={`sms:?&body=${encodeURIComponent(message)}`} className={buttonClass("secondary", "sm")}>
        <MessageSquare className="size-4" aria-hidden /> Send by SMS
      </a>
    </div>
  );
}
