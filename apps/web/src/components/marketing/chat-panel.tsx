"use client";
import * as React from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquareText, Send, UserRound, X } from "lucide-react";
import { Button, cn } from "@im/ui";

const SUGGESTIONS = ["What is Covva?", "How do I get a quote?", "How do claims work?", "Can I pay with mobile money?"];

/**
 * The "Chat with us" panel (loaded on demand by <ChatWidget />, so the AI SDK is not in every page's bundle). Talks to /api/ai/faq — the same FAQ
 * assistant as the WhatsApp bot, with the same guardrails (no advice, no prices, no account
 * data). The "Talk to a human / my broker" button opens WhatsApp when a business number is
 * configured, otherwise the contact (callback) form.
 */
export default function ChatPanel({ open, onClose, whatsappNumber }: { open: boolean; onClose: () => void; whatsappNumber?: string | null }) {
  const [input, setInput] = React.useState("");
  const transport = React.useMemo(() => new DefaultChatTransport({ api: "/api/ai/faq" }), []);
  const { messages, sendMessage, status, error, stop, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const digits = (whatsappNumber ?? "").replace(/\D/g, "");
  const humanHref = digits ? `https://wa.me/${digits}?text=${encodeURIComponent("Hello Covva, I'd like to talk to a person about insurance.")}` : "/contact?topic=customer";

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
    void sendMessage({ text: t });
    setInput("");
  }

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Chat with us"
          data-testid="chat-widget"
          className="fixed inset-x-2 bottom-20 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-card border border-line bg-white shadow-float sm:inset-x-auto sm:right-6 sm:w-[400px] sm:bottom-6"
        >
          <header className="flex items-start gap-3 border-b border-line px-4 py-3">
            <span className="mt-0.5 grid size-8 place-items-center rounded-full bg-mint text-brand">
              <MessageSquareText aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Chat with us</p>
              <p className="text-xs text-muted">AI-assisted answers about how Covva works. Licensed brokers advise; insurers decide claims.</p>
            </div>
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted hover:bg-mist" aria-label="Close chat">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-ink-2">
                  Ask me how quotes, payments, claims or renewals work. I can&apos;t recommend a product or quote a price — a licensed broker does that — and I can&apos;t see your account.
                </p>
                <p className="mt-2 text-xs text-subtle" data-testid="chat-disclaimer">
                  Covva provides the technology. We are not an insurer or broker. Payments are processed by Paystack. Paystack splits each payment, sending the partner&apos;s share directly to the partner and Covva&apos;s commission directly to Covva. English for now; Twi, Ga and Ewe are coming.
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
                <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-brand text-white" : "bg-mist text-ink")}>
                  {m.parts.map((p, i) => (p.type === "text" ? <React.Fragment key={i}>{p.text}</React.Fragment> : null))}
                </div>
              </div>
            ))}
            {status === "submitted" && <p className="text-xs text-muted">Thinking…</p>}
            {error && (
              <div role="alert" className="rounded-xl bg-amber-bg px-3 py-2 text-sm text-amber">
                The assistant isn&apos;t available right now. Use the button below to reach a person.
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line px-3 pt-2">
            {digits ? (
              <a href={humanHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-mist">
                <UserRound aria-hidden className="size-3.5" /> Talk to a human / my broker
              </a>
            ) : (
              <Link href={humanHref} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-mist">
                <UserRound aria-hidden className="size-3.5" /> Talk to a human / my broker
              </Link>
            )}
          </div>
          <form
            className="flex items-end gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <label htmlFor="chat-widget-input" className="sr-only">Your question</label>
            <textarea
              ref={inputRef}
              id="chat-widget-input"
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
