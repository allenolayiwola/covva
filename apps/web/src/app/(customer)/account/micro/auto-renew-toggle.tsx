"use client";
import { useTransition, useState } from "react";
import { Checkbox } from "@im/ui";
import { toggleAutoRenew } from "./actions";

export function AutoRenewToggle({ policyId, initial }: { policyId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Checkbox
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const r = await toggleAutoRenew(policyId, next);
            if (!r.ok) setOn(!next);
            setMessage(r.error ?? r.message ?? null);
          });
        }}
        label={<span className="text-sm text-ink-2">Auto-renew before my cover ends</span>}
      />
      {message && <p className="mt-1 text-xs text-muted" role="status">{message}</p>}
    </div>
  );
}
