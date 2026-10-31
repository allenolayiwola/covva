import type { Metadata } from "next";
import { EMBED_DISCLOSURE } from "@im/core";

export const metadata: Metadata = {
  title: "Covva quotes",
  robots: { index: false, follow: false },
};

/**
 * Embeddable widget shell (/embed/*): no marketing header or footer. Framed only by the partner's
 * allowed domains (CSP frame-ancestors from src/proxy.ts; the global X-Frame-Options skips /embed).
 * The mandatory disclosure is always visible. Payments are never collected inside the iframe.
 */
export default function EmbedLayout({ children }: LayoutProps<"/embed">) {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-ink">
      <main id="main" className="flex-1 px-4 py-4 sm:px-5">{children}</main>
      <footer className="border-t border-line px-4 py-3 text-center text-[11px] leading-snug text-muted sm:px-5">
        <p>{EMBED_DISCLOSURE}</p>
        <p className="mt-0.5">Covva is a technology platform, not an insurer or broker, and never holds your premium.</p>
      </footer>
    </div>
  );
}
