"use client";

import * as React from "react";

export const PREVIEW_COOKIE = "covva_preview";

/** Current path + whether the preview cookie is set; read on the client only (server snapshot: off). */
function snapshot(): string {
  const on = document.cookie.split(/;\s*/).some((c) => c.startsWith(`${PREVIEW_COOKIE}=`));
  return on ? window.location.pathname : "";
}
const noSubscribe = () => () => {};

/**
 * "You are previewing unpublished content" bar for CMS editors. It keys off a small, non-httpOnly
 * cookie set by /api/preview next to Next's draft-mode cookie, so the marketing pages stay fully
 * static: nothing on the server (and no URL hook on the client) decides whether to show it.
 */
export function PreviewBanner() {
  const path = React.useSyncExternalStore(noSubscribe, snapshot, () => "");
  if (!path) return null;
  return (
    <div role="status" className="sticky top-0 z-50 flex min-h-10 flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold px-4 py-2 text-center text-[13px] font-medium text-ink">
      <span>Preview: you are seeing unpublished CMS changes.</span>
      <a href={`/api/preview/exit?path=${encodeURIComponent(path)}`} className="inline-flex min-h-10 items-center rounded px-2 font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
        Exit preview
      </a>
    </div>
  );
}
