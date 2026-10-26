"use client";

import * as React from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";
import { buttonClass } from "@im/ui";

export const CONSENT_COOKIE = "covva_consent";
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID || "";
const EVENT = "covva:consent";
type Choice = "all" | "essential";

function readConsent(): Choice | "" {
  const m = document.cookie.match(/(?:^|;\s*)covva_consent=(all|essential)/);
  return (m?.[1] as Choice | undefined) ?? "";
}
function writeConsent(choice: Choice) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${60 * 60 * 24 * 180}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

function loadGa4(id: string) {
  if (document.getElementById("ga4-src")) return;
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag(...args: unknown[]) {
    w.dataLayer!.push(args);
  };
  w.gtag("js", new Date());
  w.gtag("config", id, { anonymize_ip: true });
  const s = document.createElement("script");
  s.id = "ga4-src";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

/**
 * Act 843-compliant consent banner. Nothing non-essential loads until the visitor chooses:
 * GA4 (when NEXT_PUBLIC_GA4_ID is set) is injected only after "Accept all"; no pixels otherwise.
 * The choice is a first-party cookie (`covva_consent`, 180 days). Server snapshot renders nothing,
 * so the banner never flashes for visitors who already chose.
 */
export function ConsentBanner() {
  const consent = React.useSyncExternalStore(subscribe, readConsent, () => "pending" as const);
  React.useEffect(() => {
    if (consent === "all" && GA4_ID) loadGa4(GA4_ID);
  }, [consent]);
  if (consent !== "") return null;

  return (
    <div role="region" aria-label="Cookie consent" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white p-4 shadow-float print:hidden sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-md sm:rounded-card sm:border sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-mint text-brand-deep"><Cookie className="size-4" /></span>
        <div className="text-[14px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">Your choice on cookies</p>
          <p className="mt-1">
            We use strictly necessary cookies to keep you signed in. With your consent we also use analytics to improve the site. No advertising pixels.
            Processed under Ghana’s Data Protection Act, 2012 (Act 843). <Link href="/legal/cookies" className="font-medium text-brand underline-offset-2 hover:underline">Cookie notice</Link>
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => writeConsent("all")} className={buttonClass("primary", "sm")}>Accept analytics</button>
        <button type="button" onClick={() => writeConsent("essential")} className={buttonClass("outline", "sm")}>Essential only</button>
      </div>
    </div>
  );
}
