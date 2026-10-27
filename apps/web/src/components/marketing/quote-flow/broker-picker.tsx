"use client";

import { Check, MapPin } from "lucide-react";
import { Pill, cn } from "@im/ui";
import { OrgTile } from "../org-tile";
import { displayOrgName } from "../org-name";
import { MAX_BROKERS, type FlowBroker } from "./model";

/**
 * Choose up to three licensed brokers (mockup 04). The first choice becomes the broker of record for the
 * request (one accountable broker per request); the others are named in the request so the broker can
 * obtain quotes from the insurers they represent. Every broker here is a DEMO placeholder until launch.
 */
export function BrokerPicker({ brokers, selected, onToggle }: { brokers: FlowBroker[]; selected: string[]; onToggle: (id: string) => void }) {
  const full = selected.length >= MAX_BROKERS;
  return (
    <div>
      <p className="text-sm text-muted" aria-live="polite">
        {selected.length === 0 ? `Pick up to ${MAX_BROKERS}. Your first choice is your broker of record.` : `${selected.length} of ${MAX_BROKERS} chosen${selected.length === 1 ? " — add up to two more for more quotes." : "."}`}
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Brokers">
        {brokers.map((b) => {
          const idx = selected.indexOf(b.id);
          const on = idx >= 0;
          const disabled = !on && full;
          const licence = b.nic_licence_number ?? "NIC/BR/0000";
          return (
            <li key={b.id}>
              <label
                className={cn(
                  "flex h-full cursor-pointer flex-col gap-3 rounded-card border bg-white p-5 transition-colors",
                  on ? "border-brand bg-mint/40" : "border-line hover:border-brand/40 hover:bg-mist",
                  disabled && "cursor-not-allowed opacity-60",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={() => onToggle(b.id)} aria-describedby={`broker-${b.id}-desc`} />
                <div className="flex items-start gap-3">
                  <OrgTile name={b.name} color={b.brand_color} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {displayOrgName(b.name)}
                      {b.demo && <Pill tone="wait">DEMO</Pill>}
                    </p>
                    {b.region && <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted"><MapPin aria-hidden className="size-3.5" />{b.region}</p>}
                  </div>
                  <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold", on ? "border-brand bg-brand text-white" : "border-line bg-white text-transparent")}>
                    {on ? (idx === 0 ? <Check className="size-4" strokeWidth={3} /> : idx + 1) : ""}
                  </span>
                </div>
                <p id={`broker-${b.id}-desc`} className="text-[14px] leading-relaxed text-muted">{b.description ?? "Licensed insurance broker on Covva."}</p>
                <p className="mt-auto text-[13px] text-subtle">
                  NIC licence {licence}
                  {b.demo && <span className="ml-1 rounded-full bg-amber-bg px-1.5 py-0.5 font-medium text-amber">placeholder</span>}
                  {on && idx === 0 && <span className="ml-2 font-medium text-brand">Broker of record</span>}
                </p>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
