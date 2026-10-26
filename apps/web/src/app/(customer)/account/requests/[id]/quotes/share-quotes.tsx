"use client";
import * as React from "react";
import { Check, Copy, Link2, Mail, MessageCircle } from "lucide-react";
import { Button, Input, cn } from "@im/ui";
import { shareQuotes } from "../actions";

/**
 * Save & share: a link (copied to the clipboard), WhatsApp (opens wa.me with the summary) or
 * email. The saved request itself is the "resume later" — this only mints a public read-only link.
 */
export function ShareQuotes({ requestId, defaultEmail, className }: { requestId: string; defaultEmail?: string | null; className?: string }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ ok: boolean; text: string; url?: string; whatsappUrl?: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const [showEmail, setShowEmail] = React.useState(false);

  const run = (channel: "link" | "whatsapp" | "email") =>
    start(async () => {
      const res = await shareQuotes(requestId, channel, channel === "email" ? email : undefined);
      const data = (res.data ?? {}) as { url?: string; whatsappUrl?: string };
      setResult({ ok: res.ok, text: res.ok ? res.message ?? "Done." : res.error ?? "Something went wrong.", url: data.url, whatsappUrl: data.whatsappUrl });
      if (!res.ok) return;
      if (channel === "link" && data.url) {
        try {
          await navigator.clipboard.writeText(data.url);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }
      if (channel === "whatsapp" && data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    });

  return (
    <div className={cn("rounded-card border border-line bg-white p-4", className)}>
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Link2 aria-hidden className="size-4 text-brand" /> Save and share these quotes
      </p>
      <p className="mt-1 text-sm text-muted">
        Your request is saved — come back any time from <span className="font-medium text-ink">Requests</span>. Share a read-only comparison with family or a friend; it never shows your name or details.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => run("link")}>
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />} {copied ? "Link copied" : "Copy link"}
        </Button>
        <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => run("whatsapp")}>
          <MessageCircle aria-hidden className="size-4" /> WhatsApp
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setShowEmail((v) => !v)} aria-expanded={showEmail}>
          <Mail aria-hidden className="size-4" /> Email
        </Button>
      </div>
      {showEmail && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run("email");
          }}
        >
          <label htmlFor="share-email" className="sr-only">Email address</label>
          <Input id="share-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required className="sm:max-w-xs" />
          <Button type="submit" size="sm" loading={pending}>Send</Button>
        </form>
      )}
      <p aria-live="polite" className={cn("mt-2 text-xs", result ? (result.ok ? "text-ink-2" : "text-danger") : "sr-only")}>
        {result?.text}
        {result?.ok && result.url && (
          <>
            {" "}
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline break-all">{result.url}</a>
          </>
        )}
      </p>
    </div>
  );
}
