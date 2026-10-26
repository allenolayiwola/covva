"use client";

import * as React from "react";
import { Smartphone, X } from "lucide-react";
import { CanopyMark } from "@im/ui";

const ANDROID_PACKAGE = process.env.NEXT_PUBLIC_ANDROID_PACKAGE || "";
const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || (ANDROID_PACKAGE ? `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` : "");
const DISMISS_KEY = "covva:app-banner:dismissed";

const noop = () => () => {};
function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Lightweight Android smart app banner (iOS uses the native `apple-itunes-app` meta tag set in the
 * layout metadata). Rendered only when NEXT_PUBLIC_ANDROID_PACKAGE is configured, only on Android,
 * and dismissible for the session. No layout shift on other devices: nothing renders.
 */
export function SmartAppBanner() {
  const isAndroid = React.useSyncExternalStore(noop, () => /android/i.test(navigator.userAgent), () => false);
  const storedDismissed = React.useSyncExternalStore(noop, readDismissed, () => true);
  const [dismissed, setDismissed] = React.useState(false);
  if (!ANDROID_PACKAGE || !isAndroid || storedDismissed || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div role="region" aria-label="Get the Covva app" className="flex items-center gap-3 border-b border-line bg-mist px-4 py-2.5 text-ink">
      <CanopyMark size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">Covva for Android</p>
        <p className="truncate text-[13px] text-muted">Quotes, MoMo payments and your policy wallet.</p>
      </div>
      <a href={PLAY_URL} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-brand px-3 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
        <Smartphone aria-hidden className="size-4" /> Get app
      </a>
      <button type="button" onClick={dismiss} aria-label="Dismiss app banner" className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
