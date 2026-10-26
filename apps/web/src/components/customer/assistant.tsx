"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Sparkles, X } from "lucide-react";
import { Button, cn } from "@im/ui";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function contextFromPath(pathname: string | null): { requestId?: string; policyId?: string } {
  if (!pathname) return {};
  const req = pathname.match(new RegExp(`/account/requests/(${UUID})`, "i"));
  const pol = pathname.match(new RegExp(`/account/policies/(${UUID})`, "i"));
  return { requestId: req?.[1], policyId: pol?.[1] };
}

const SUGGESTIONS = ["What does my policy cover?", "What is an excess?", "How do I report a claim?", "What happens at renewal?"];

/**
 * "Ask about my cover" — floating AI assistant. Talks to /api/ai/assistant (Backend stream).
 * AI explains and summarises; it never decides suitability or claims.
 */
export function Assistant() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const ctx = contextFromPath(pathname);
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/ai/assistant" }), []);
  const { messages, sendMessage, status, error, stop, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (error) clearError();
    // Page context (request/policy being viewed) goes in the request body.
    void sendMessage({ text: t }, { body: { ...ctx } });
    setInput("");
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-[84px] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-float hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 lg:bottom-14 lg:right-6"
        >
          <Sparkles aria-hidden className="size-4" />
          Ask about my cover
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Ask about my cover"
          className="fixed inset-x-2 bottom-[84px] z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-card border border-line bg-white shadow-float sm:inset-x-auto sm:right-4 sm:w-[400px] lg:bottom-6 lg:right-6"
        >
          <header className="flex items-start gap-3 border-b border-line px-4 py-3">
            <span className="mt-0.5 grid size-8 place-items-center rounded-full bg-mint text-brand">
              <Sparkles aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Ask about my cover</p>
              <p className="text-xs text-muted">AI-assisted — your broker gives advice; the insurer decides claims.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full text-muted hover:bg-mist" aria-label="Close assistant">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-ink-2">
                  I can explain your cover, quotes and documents in plain language. I can&apos;t recommend a product or decide a claim — for that, message your broker.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-brand-deep hover:bg-mist">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user" ? "bg-brand text-white" : "bg-mist text-ink",
                  )}
                >
                  {m.parts.map((p, i) => (p.type === "text" ? <React.Fragment key={i}>{p.text}</React.Fragment> : null))}
                </div>
              </div>
            ))}
            {status === "submitted" && <p className="text-xs text-muted">Thinking…</p>}
            {error && (
              <div role="alert" className="rounded-xl bg-amber-bg px-3 py-2 text-sm text-amber">
                The assistant isn&apos;t available right now. Please try again later, or message your broker.
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <label htmlFor="assistant-input" className="sr-only">Your question</label>
            <textarea
              ref={inputRef}
              id="assistant-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="Ask a question…"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-field border border-line px-3.5 py-2.5 text-sm text-ink placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            {busy ? (
              <Button type="button" variant="outline" size="md" onClick={() => void stop()} aria-label="Stop">Stop</Button>
            ) : (
              <Button type="submit" size="md" aria-label="Send" disabled={!input.trim()}>
                <Send aria-hidden className="size-4" />
              </Button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
