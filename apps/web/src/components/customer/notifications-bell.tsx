"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { formatDateTime } from "@im/core";
import type { Row } from "@im/db";
import { cn } from "@im/ui";
import { createClient } from "@/lib/supabase/client";

type Note = Pick<Row<"notifications">, "id" | "title" | "body" | "link" | "read_at" | "created_at" | "kind">;

/**
 * Bell + dropdown with the latest 10 notifications. Reads directly with the browser client (RLS:
 * own rows only) and stays live through Supabase Realtime, so the server layout needn't wait on it.
 */
export function NotificationsBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Note[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  const load = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, title, body, link, read_at, created_at, kind")
      .order("created_at", { ascending: false })
      .limit(10);
    setItems(data ?? []);
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      await load();
      channel = supabase
        .channel(`notifications:${data.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${data.user.id}` }, () => void load())
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  // Close on navigation; outside click / Escape below. (adjust state during render rather than in an effect).
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    await createClient().from("notifications").update({ read_at: now }).in("id", ids).is("read_at", null);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-10 place-items-center rounded-full text-ink-2 hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Bell aria-hidden className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold leading-4 text-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,360px)] overflow-hidden rounded-card border border-line bg-white shadow-float">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold text-ink">Notifications</p>
            {unread > 0 && (
              <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => void markRead(items.filter((n) => !n.read_at).map((n) => n.id))}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {!loaded && <li className="px-4 py-6 text-center text-sm text-muted">Loading…</li>}
            {loaded && items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            {items.map((n) => {
              const body = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read_at && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />}
                    <span className={cn("text-sm", n.read_at ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                  </span>
                  {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-subtle">{formatDateTime(n.created_at)}</span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.link && n.link.startsWith("/") ? (
                    <Link
                      href={n.link}
                      className="block px-4 py-3 hover:bg-mist"
                      onClick={() => {
                        void markRead([n.id]);
                        router.refresh();
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button type="button" className="block w-full px-4 py-3 text-left hover:bg-mist" onClick={() => void markRead([n.id])}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
