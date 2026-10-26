"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface RealtimeWatch {
  table: "requests" | "request_tasks" | "request_messages" | "quotes" | "policies" | "claims" | "notifications";
  /** Postgres-changes filter, e.g. `request_id=eq.<uuid>` */
  filter?: string;
}

/**
 * Subscribes to Supabase Realtime changes and refreshes the current route (server components
 * re-render with fresh RLS-scoped data). Debounced so a burst of changes costs one refresh.
 * Renders nothing.
 */
export function RealtimeRefresh({ channel, watch, onChange }: { channel: string; watch: RealtimeWatch[]; onChange?: () => void }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify(watch);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel(`${channel}:${Math.random().toString(36).slice(2, 8)}`);
    const trigger = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onChange?.();
        router.refresh();
      }, 400);
    };
    for (const w of JSON.parse(key) as RealtimeWatch[]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: w.table, ...(w.filter ? { filter: w.filter } : {}) }, trigger);
    }
    ch.subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key, router]);

  return null;
}
