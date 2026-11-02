"use client";

import * as React from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";
import { Checkbox, buttonClass, cn } from "@im/ui";
import { CONSENT_ANCHOR, CONSENT_COOKIE, GA4_ID, PIXELS_CONFIGURED, applyConsent, choiceFromConsent, readConsent, subscribeConsent, writeConsent, type ConsentChoice } from "./analytics";

export { CONSENT_COOKIE };

/**
 * Runs inline before first paint: hides the server-rendered bar for visitors who already chose, so there
 * is no flash while React hydrates (after hydration the component unmounts it for real).
 */
const HIDE_IF_CHOSEN = `if(/(?:^|;\\s*)covva_consent=(all|analytics|essential)(?:;|$)/.test(document.cookie)){var s=document.currentScript;if(s&&s.parentNode){s.parentNode.style.display="none"}}`;

/**
 * Act 843-compliant consent bar, as a slim pill: bottom-left on desktop, full width on phones (well under 15%
 * of the first screen). Nothing non-essential loads until the visitor chooses: GA4 (NEXT_PUBLIC_GA4_ID) only
 * after analytics consent; the Meta/TikTok pixels only after marketing consent. "Choose" opens the two
 * categories. The choice is a first-party cookie (`covva_consent`, 180 days).
 *
 * The bar is part of the server HTML, so it paints with the page. Reject and Accept also work before React
 * hydrates (slow phones, quick taps) and without JavaScript: they are submit buttons in a plain form that posts
 * to /api/consent, which sets the same cookie and redirects back to `<page>#cookie-consent`, where the
 * `:target` rule in globals.css hides the bar. Once hydrated, their click handlers cancel the submit and write
 * the cookie in the browser instead (no reload). "Settings" (and so "Save choices") needs JavaScript.
 * HIDE_IF_CHOSEN hides the bar before first paint for visitors who already chose.
 */
export function ConsentBanner() {
  const consent = React.useSyncExternalStore(subscribeConsent, readConsent, () => "" as const);
  const [manage, setManage] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(true);
  const [marketing, setMarketing] = React.useState(false);

  React.useEffect(() => {
    if (consent) applyConsent(consent);
  }, [consent]);
  // Arrived from the no-JavaScript path (POST /api/consent → #cookie-consent): drop the fragment so the
  // `:target` rule cannot hide the bar if the visitor later resets their choice on this page.
  React.useEffect(() => {
    if (window.location.hash === `#${CONSENT_ANCHOR}`) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }, []);
  if (consent !== "") return null;

  const choose = (choice: ConsentChoice) => writeConsent(choice);
  const acceptChoice: ConsentChoice = PIXELS_CONFIGURED ? "all" : "analytics";
  /** Hydrated: record the choice in the browser and cancel the form post. */
  const submitChoice = (choice: ConsentChoice) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    choose(choice);
  };

  return (
    <div
      id={CONSENT_ANCHOR}
      role="region"
      aria-label="Cookie consent"
      data-consent-banner
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white shadow-float print:hidden",
        "sm:inset-x-auto sm:bottom-5 sm:left-5 sm:border",
        manage ? "rounded-t-2xl p-4 sm:max-w-md sm:rounded-card sm:p-5" : "px-4 py-2.5 sm:max-w-2xl sm:rounded-full sm:py-2 sm:pl-4 sm:pr-2",
      )}
    >
      <script dangerouslySetInnerHTML={{ __html: HIDE_IF_CHOSEN }} />

      {manage ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[15px] font-semibold text-ink">Choose your cookies</p>
            <button type="button" onClick={() => setManage(false)} aria-label="Back to the short version" className="grid size-8 place-items-center rounded-full text-muted hover:bg-mist">
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <fieldset className="mt-3 grid gap-3">
            <legend className="sr-only">Choose which cookies to allow</legend>
            <Checkbox checked disabled label={<><span className="font-medium text-ink">Strictly necessary</span> — sign-in, saved progress, your choices. Always on.</>} />
            <Checkbox
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              label={<><span className="font-medium text-ink">Analytics</span> — Google Analytics 4 with IP anonymisation{GA4_ID ? "" : " (not configured on this site)"}.</>}
            />
            {PIXELS_CONFIGURED && (
              <Checkbox
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                label={<><span className="font-medium text-ink">Marketing</span> — Meta and TikTok pixels to measure our own adverts. Never used to sell your data.</>}
              />
            )}
          </fieldset>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Processed under Ghana’s Data Protection Act, 2012 (Act 843). <Link href="/legal/cookies" className="font-medium text-brand underline-offset-2 hover:underline">Cookie notice</Link>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => choose(choiceFromConsent({ analytics, marketing: PIXELS_CONFIGURED && marketing }))} className={buttonClass("primary", "sm")}>Save choices</button>
            <button type="button" onClick={() => choose("essential")} className={buttonClass("outline", "sm")}>Essential only</button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span aria-hidden className="hidden size-8 shrink-0 place-items-center rounded-full bg-mint text-brand-deep sm:grid"><Cookie className="size-4" /></span>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
            Optional cookies need consent. <Link href="/legal/cookies" className="font-medium text-brand underline-offset-2 hover:underline">Notice</Link>
          </p>
          {/* A real form so Reject / Accept work before hydration and without JavaScript (see the comment above). */}
          <form method="post" action="/api/consent" className="flex shrink-0 items-center gap-1.5">
            <button type="submit" name="choice" value="essential" onClick={submitChoice("essential")} aria-label="Reject — Essential only" className={buttonClass("outline", "sm", "flex-1 px-3 sm:flex-none")}>Reject</button>
            <button type="button" onClick={() => setManage(true)} aria-label="Settings — Choose for me" className={buttonClass("outline", "sm", "flex-1 px-3 sm:flex-none")}>Settings</button>
            <button type="submit" name="choice" value={acceptChoice} onClick={submitChoice(acceptChoice)} className={buttonClass("primary", "sm", "flex-1 px-3.5 sm:flex-none")}>Accept</button>
          </form>
        </div>
      )}
    </div>
  );
}
