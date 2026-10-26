"use client";

import * as React from "react";
import { Settings2 } from "lucide-react";
import { buttonClass } from "@im/ui";
import { clearConsent, readConsent, subscribeConsent } from "./analytics";

const LABEL: Record<string, string> = { all: "analytics and marketing", analytics: "analytics only", essential: "essential cookies only" };

/**
 * "Change your cookie choices" control for the cookie notice. Forgetting the stored choice brings the
 * consent banner back; vendors already loaded on this page stop receiving events once the choice is gone
 * because `track()` checks the applied consent on every call.
 */
export function ConsentSettings() {
  const choice = React.useSyncExternalStore(subscribeConsent, readConsent, () => "" as const);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-mist/60 p-4">
      <p className="text-sm text-ink-2" role="status">
        {choice ? <>Your current choice: <strong className="text-ink">{LABEL[choice] ?? choice}</strong>.</> : <>You have not made a choice yet, or it has been reset.</>}
      </p>
      <button type="button" onClick={() => { clearConsent(); window.location.reload(); }} className={buttonClass("outline", "sm")}>
        <Settings2 aria-hidden className="size-4" /> Change your cookie choices
      </button>
    </div>
  );
}
