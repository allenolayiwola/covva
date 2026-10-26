"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Supabase Realtime changes on a table (RLS applies to the payloads)
 * and refreshes the current route so server-rendered lists stay live.
 */
export function RealtimeRefresh({ table, filter, channel }: { table: "requests" | "quotes" | "policies" | "claims" | "request_messages" | "request_tasks"; filter?: string; channel: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 600);
      })
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, [router, table, filter, channel]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-subtle" title="This list updates automatically">
      <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Live
    </span>
  );
}
