"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Checkpoints, Pill, buttonClass, cn, type TimelineStep } from "@im/ui";
import { FULFILMENT_CHECKPOINTS, relativeDue } from "@im/core";
import type { Tone } from "@im/core";

export interface QueueRow {
  id: string;
  reference: string;
  customer: string;
  kind: string;
  source: string;
  statusLabel: string;
  statusTone: Tone;
  owner: string;
  ownerDetail?: string;
  dueAt: string | null;
  dueHint?: string;
  preview: {
    insurer: string | null;
    checklist: { label: string; done: boolean }[];
    checkpoints: boolean[];
  };
}

export function QueueTable({ rows, demo }: { rows: QueueRow[]; demo: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-mist text-xs font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Request / customer</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Next response</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const due = relativeDue(r.dueAt);
              const isSel = selected?.id === r.id;
              return (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-selected={isSel}
                  onClick={() => setSelectedId(r.id)}
                  onDoubleClick={() => router.push(`/partner/requests/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/partner/requests/${r.id}`);
                    if (e.key === " ") {
                      e.preventDefault();
                      setSelectedId(r.id);
                    }
                  }}
                  className={cn("cursor-pointer border-t border-line outline-none transition-colors focus-visible:bg-mist", isSel ? "bg-mist" : "hover:bg-mist/50")}
                >
                  <td className="px-4 py-4">
                    <Link href={`/partner/requests/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-ink hover:text-brand">
                      {r.reference} · {r.customer}
                    </Link>
                    <p className="mt-1 text-[13px] text-muted">{r.kind}</p>
                  </td>
                  <td className="px-4 py-4 text-ink-2">{r.source}</td>
                  <td className="px-4 py-4"><Pill tone={r.statusTone} className="px-3 py-1 font-semibold">{r.statusLabel}</Pill></td>
                  <td className="px-4 py-4 text-ink-2">
                    {r.owner}
                    {r.ownerDetail && <p className="text-xs text-subtle">{r.ownerDetail}</p>}
                  </td>
                  <td className="px-4 py-4">
                    <p className={cn("font-semibold", due.overdue ? "text-danger" : "text-ink")}>{due.label}</p>
                    {due.atRisk ? <p className="text-xs text-amber">{due.overdue ? "Overdue" : "At risk"}</p> : r.dueHint ? <p className="text-xs text-subtle">{r.dueHint}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="rounded-card border border-line bg-white p-5">
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              {selected.reference}
              {selected.preview.insurer ? ` · ${selected.preview.insurer}` : ""}
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {selected.preview.checklist.length === 0 && <li className="text-muted">○ No open tasks on this request</li>}
              {selected.preview.checklist.map((c, i) => (
                <li key={i} className={c.done ? "text-brand" : "text-muted"}>
                  {c.done ? "✓" : "○"} {c.label}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/partner/requests/${selected.id}#tasks`} className={buttonClass("secondary", "md")}>Request document</Link>
              <Link href={`/partner/requests/${selected.id}#quotes`} className={buttonClass("primary", "md")}>Prepare quote</Link>
              <Link href={`/partner/requests/${selected.id}`} className={buttonClass("ghost", "md")}>Open workspace →</Link>
            </div>
          </div>
          <FulfilmentCard done={selected.preview.checkpoints} demo={demo} />
        </div>
      )}
    </>
  );
}

export function FulfilmentCard({ done, demo, className }: { done: boolean[]; demo?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-card bg-mist p-5", className)}>
      <h2 className="text-xl font-semibold tracking-tight text-ink">Fulfilment checkpoints</h2>
      <Checkpoints className="mt-2" labels={FULFILMENT_CHECKPOINTS.map((c) => c.label)} done={done} />
      <div className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
        <p>No active policy until issuance is confirmed.</p>
        {demo && <p>Sample statuses and targets. No live policy.</p>}
      </div>
    </div>
  );
}

export type { TimelineStep };
