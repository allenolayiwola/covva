import { MessageCircle } from "lucide-react";

/**
 * Floating WhatsApp chat button, shown on every marketing page when NEXT_PUBLIC_WHATSAPP_NUMBER is set
 * (international format, digits only, e.g. 233501234567). Hidden entirely when unset.
 */
export function WhatsAppButton() {
  const raw = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const text = encodeURIComponent("Hello Covva, I have a question about insurance.");
  return (
    <a
      href={`https://wa.me/${digits}?text=${text}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp (opens in a new tab)"
      className="fixed bottom-5 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[#128C7E] pl-3 pr-4 text-sm font-semibold text-white shadow-float transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none sm:bottom-6 sm:right-6 print:hidden"
    >
      <MessageCircle aria-hidden className="size-5" strokeWidth={2} />
      <span className="hidden sm:inline">WhatsApp us</span>
      <span className="sm:hidden">Chat</span>
    </a>
  );
}
