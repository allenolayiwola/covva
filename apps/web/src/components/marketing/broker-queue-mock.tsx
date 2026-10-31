import { Check, ChevronDown, Circle } from "lucide-react";
import { cn } from "@im/ui";

/**
 * Stylised HTML replica of the broker request-queue mockup. Decorative: hidden from
 * assistive tech; the page describes it in text.
 */
export function BrokerQueueMock({ className }: { className?: string }) {
  const rows = [
    { id: "DEMO-028", who: "Ama K.", what: "Motor renewal", source: "Mobile", status: "Awaiting document", wait: true, owner: "Team A", due: "Tomorrow", dueNote: "Follow up", risk: false, active: true },
    { id: "DEMO-031", who: "Kofi M.", what: "Travel cover", source: "Web", status: "Quote preparation", wait: false, owner: "Team B", due: "Today, 16:00", dueNote: "At risk", risk: true, active: false },
    { id: "DEMO-034", who: "Esi A.", what: "Home & contents", source: "Web", status: "Insurer response", wait: false, owner: "Team A", due: "Thu", dueNote: "On track", risk: false, active: false },
  ];
  return (
    <div aria-hidden className={cn("select-none overflow-hidden rounded-[22px] border border-line bg-white shadow-float", className)}>
      <div className="flex items-center gap-2 border-b border-line bg-mist px-4 py-3">
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="ml-3 h-5 flex-1 rounded-md bg-white" />
      </div>
      <div className="flex">
        <div className="hidden w-40 shrink-0 border-r border-line bg-mist/60 p-3 text-sm md:block">
          {["Overview", "Request queue", "Quotes", "Customers", "Policies", "Service & claims", "Reports"].map((l) => (
            <p key={l} className={cn("rounded-lg px-2.5 py-2", l === "Request queue" ? "bg-mint font-semibold text-brand-deep" : "text-muted")}>{l}</p>
          ))}
          <div className="mt-6 rounded-xl border border-line bg-white p-2.5">
            <p className="font-semibold text-ink">Demo Broker</p>
            <p className="mt-0.5 text-sm leading-snug text-muted">Human help, when you need it.</p>
          </div>
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[18px] font-bold tracking-tight text-ink">Request queue</p>
              <p className="text-sm text-muted">One queue for mobile and web. Clear ownership at every step.</p>
            </div>
            <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">Create request</span>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { l: "New requests", v: "08", warn: false },
              { l: "Awaiting documents", v: "05", warn: false },
              { l: "Response target at risk", v: "02", warn: true },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-line p-2.5">
                <p className="break-words text-sm text-muted">{s.l}</p>
                <p className={cn("mt-1 text-[20px] font-bold tabular-nums", s.warn ? "text-amber" : "text-ink")}>{s.v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
            <span className="rounded-md bg-mint px-2 py-1 font-medium text-brand-deep">All open · 21</span>
            {["Assigned to me", "Motor", "Source: all", "Due next"].map((f) => (
              <span key={f} className="inline-flex items-center gap-0.5 rounded-md border border-line px-2 py-1 text-muted">
                {f}
                {f !== "Assigned to me" && <ChevronDown className="size-2.5" />}
              </span>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <div className="hidden gap-2 bg-mist sm:grid px-3 py-2 text-sm font-semibold uppercase tracking-wider text-muted sm:grid-cols-[1.6fr_0.7fr_1.2fr_0.7fr_0.9fr]">
              <span>Request / customer</span>
              <span className="hidden sm:block">Source</span>
              <span>Status</span>
              <span className="hidden sm:block">Owner</span>
              <span>Next response</span>
            </div>
            {rows.map((r) => (
              <div key={r.id} className={cn("grid grid-cols-1 items-start sm:items-center gap-2 border-t border-line px-3 py-2.5 sm:grid-cols-[1.6fr_0.7fr_1.2fr_0.7fr_0.9fr]", r.active && "bg-mist")}>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-ink">{r.id} · {r.who}</p>
                  <p className="break-words text-sm text-muted">{r.what}</p>
                </div>
                <span className="hidden text-sm text-ink-2 sm:block">{r.source}</span>
                <span className={cn("w-fit min-w-0 break-words rounded-full px-2 py-0.5 text-sm font-medium", r.wait ? "bg-amber-bg text-amber" : "bg-mint text-brand-dark")}>{r.status}</span>
                <span className="hidden text-sm text-ink-2 sm:block">{r.owner}</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-ink">{r.due}</p>
                  <p className={cn("text-sm", r.risk ? "text-amber" : "text-muted")}>{r.dueNote}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-3">
              <p className="text-sm font-semibold text-ink">DEMO-028 · Example Insurer A</p>
              <p className="mt-1.5 flex items-center gap-1 text-sm text-brand"><Check className="size-3" />Needs and renewal date captured</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted"><Circle className="size-2.5" />Vehicle document requested</p>
            </div>
            <div className="rounded-xl bg-mist p-3">
              <p className="text-sm font-semibold text-ink">Fulfilment checkpoints</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">Confirm choice → Verify payment → Insurer issue → Deliver policy documents</p>
              <p className="mt-1 text-sm text-subtle">No active policy until issuance is confirmed.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
