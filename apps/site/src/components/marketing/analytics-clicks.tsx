"use client";

import * as React from "react";
import { track } from "./analytics";

/**
 * One delegated click listener for the outbound conversion links that are rendered by server components
 * (store badges, WhatsApp button), so those components stay server-only and free of analytics code.
 * Renders nothing.
 */
export function AnalyticsClicks() {
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.href;
      if (/apps\.apple\.com/.test(href)) track("app_store_click", { store: "apple", page: location.pathname });
      else if (/play\.google\.com/.test(href)) track("app_store_click", { store: "google", page: location.pathname });
      else if (/^https:\/\/wa\.me\//.test(href)) track("whatsapp_click", { page: location.pathname });
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
