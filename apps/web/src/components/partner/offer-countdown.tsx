"use client";
import { useEffect, useState } from "react";
import { cn } from "@im/ui";

function label(ms: number): string {
  if (ms <= 0) return "Expired";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins >= 60) return `${Math.floor(mins / 60)} h ${mins % 60} min left`;
  if (mins >= 5) return `${mins} min left`;
  return `${mins}:${String(secs).padStart(2, "0")} left`;
}

/** Live "12 min left" countdown to an offer's deadline (renders a static value on the server). */
export function OfferCountdown({ respondsBy, className }: { respondsBy: string; className?: string }) {
  const deadline = new Date(respondsBy).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = now === null ? null : deadline - now;
  const urgent = remaining !== null && remaining < 5 * 60_000;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", remaining !== null && remaining <= 0 ? "bg-mist text-muted" : urgent ? "bg-danger-bg text-danger" : "bg-amber-bg text-amber", className)}
      title={`Accept by ${new Date(respondsBy).toLocaleString()}`}
      aria-live="polite"
    >
      {remaining === null ? "…" : label(remaining)}
    </span>
  );
}
