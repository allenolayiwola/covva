"use client";

import * as React from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";
import { Checkbox, buttonClass } from "@im/ui";
import { CONSENT_COOKIE, GA4_ID, PIXELS_CONFIGURED, applyConsent, choiceFromConsent, readConsent, subscribeConsent, writeConsent, type ConsentChoice } from "./analytics";

export { CONSENT_COOKIE };

/**
 * Runs inline before first paint: hides the server-rendered banner for visitors who already chose, so there
 * is no flash while React hydrates (after hydration the component unmounts it for real).
 */
const HIDE_IF_CHOSEN = `if(/(?:^|;\\s*)covva_consent=(all|analytics|essential)(?:;|$)/.test(document.cookie)){var s=document.currentScript;if(s&&s.parentNode){s.parentNode.style.display="none"}}`;

/**
 * Act 843-compliant consent banner. Nothing non-essential loads until the visitor chooses:
 * GA4 (NEXT_PUBLIC_GA4_ID) only after analytics consent; the Meta/TikTok pixels (NEXT_PUBLIC_META_PIXEL_ID,
 * NEXT_PUBLIC_TIKTOK_PIXEL_ID) only after marketing consent. "Choose for me" exposes the two categories
 * separately. The choice is a first-party cookie (`covva_consent`, 180 days).
 *
 * The banner is part of the server HTML (so it paints with the page and works without JavaScript); the inline
 * HIDE_IF_CHOSEN script hides it before first paint for returning visitors and hydration then removes it.
 */
export function ConsentBanner() {
  const consent = React.useSyncExternalStore(subscribeConsent, readConsent, () => "" as const);
  const [manage, setManage] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(true);
  const [marketing, setMarketing] = React.useState(false);
  const acceptAllLabel = PIXELS_CONFIGURED ? "Accept all" : "Accept analytics";

  React.useEffect(() => {
    if (consent) applyConsent(consent);
  }, [consent]);
  if (consent !== "") return null;

  const choose = (choice: ConsentChoice) => writeConsent(choice);

  return (
    <div role="region" aria-label="Cookie consent" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white p-4 shadow-float print:hidden sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-md sm:rounded-card sm:border sm:p-5">
      <script dangerouslySetInnerHTML={{ __html: HIDE_IF_CHOSEN }} />
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-mint text-brand-deep"><Cookie className="size-4" /></span>
        <div className="text-[14px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">Your choice on cookies</p>
          <p className="mt-1">
            We use strictly necessary cookies to keep you signed in. With your consent we also use analytics to improve the site
            {PIXELS_CONFIGURED ? " and advertising pixels (Meta, TikTok) to measure our own campaigns" : ""}.
            {PIXELS_CONFIGURED ? "" : " No advertising pixels."} Processed under Ghana’s Data Protection Act, 2012 (Act 843).{" "}
            <Link href="/legal/cookies" className="font-medium text-brand underline-offset-2 hover:underline">Cookie notice</Link>
          </p>
        </div>
      </div>

      {manage && (
        <fieldset className="mt-4 grid gap-3 rounded-xl border border-line bg-mist/60 p-3">
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
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {manage ? (
          <button type="button" onClick={() => choose(choiceFromConsent({ analytics, marketing: PIXELS_CONFIGURED && marketing }))} className={buttonClass("primary", "sm")}>Save choices</button>
        ) : (
          <button type="button" onClick={() => choose(PIXELS_CONFIGURED ? "all" : "analytics")} className={buttonClass("primary", "sm")}>{acceptAllLabel}</button>
        )}
        <button type="button" onClick={() => choose("essential")} className={buttonClass("outline", "sm")}>Essential only</button>
        {!manage && (
          <button type="button" onClick={() => setManage(true)} className={buttonClass("ghost", "sm")}>Choose for me</button>
        )}
      </div>
    </div>
  );
}
