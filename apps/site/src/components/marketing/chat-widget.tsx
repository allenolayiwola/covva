"use client";
import * as React from "react";
import { MessageSquareText } from "lucide-react";

// The panel carries the AI SDK (useChat + transport, ~60 KB gzipped with its schema library), so it is
// split out and fetched only when someone opens the chat; hovering or focusing the launcher starts the fetch early.
const loadPanel = () => import("./chat-panel");
const ChatPanel = React.lazy(loadPanel);

/**
 * "Chat with us" on every marketing page: a launcher button, and the chat panel loaded on first open. Once
 * loaded the panel stays mounted (hidden while closed) so the conversation survives closing and reopening.
 * The panel talks to /api/ai/faq, the same FAQ assistant as the WhatsApp bot, with the same guardrails.
 */
export function ChatWidget({ whatsappNumber }: { whatsappNumber?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const prefetch = () => void loadPanel();

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          data-chat-launcher
          className="fixed bottom-5 right-4 z-40 inline-flex h-12 w-[5.5rem] items-center justify-center gap-2 rounded-full bg-brand px-3 text-sm font-semibold text-white shadow-float transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none sm:bottom-6 sm:right-6 sm:w-[9.5rem] print:hidden"
          aria-label="Chat with us"
        >
          <MessageSquareText aria-hidden className="size-5" strokeWidth={2} />
          <span className="hidden sm:inline">Chat with us</span>
          <span className="sm:hidden">Chat</span>
        </button>
      )}
      {loaded && (
        <React.Suspense
          fallback={
            open ? (
              <div role="status" className="fixed inset-x-2 bottom-20 z-50 rounded-card border border-line bg-white px-4 py-6 text-center text-sm text-muted shadow-float sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[400px]">
                Opening chat…
              </div>
            ) : null
          }
        >
          <ChatPanel open={open} onClose={() => setOpen(false)} whatsappNumber={whatsappNumber} />
        </React.Suspense>
      )}
    </>
  );
}
