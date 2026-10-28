import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Plus, ScrollText } from "lucide-react";
import { OPEN_REQUEST_STATUSES, REQUEST_STATUS, formatDate, relativeDue } from "@im/core";
import { EmptyState, PageHeader, StatusPill, buttonClass } from "@im/ui";
import { CategoryIcon } from "@/components/customer/category-icon";
import { ListSkeleton } from "@/components/customer/skeletons";
import { REQUEST_SELECT, account, type RequestWithRefs } from "../_lib/data";
import { REQUEST_TYPE_LABEL } from "../_lib/labels";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return (
    <>
      <PageHeader
        title="Requests"
        description="Every quote, renewal, change and switch you've asked for, with what's happening now."
        actions={
          <Link href="/account/requests/new" className={buttonClass("primary")}>
            <Plus aria-hidden className="size-4" /> New request
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <RequestList />
      </Suspense>
    </>
  );
}

async function RequestList() {
  const { user, supabase } = await account("/account/requests");
  const { data } = await supabase
    .from("requests")
    .select(`${REQUEST_SELECT}, request_tasks(id, status, assignee_party)`)
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as (RequestWithRefs & { request_tasks: { status: string; assignee_party: string }[] })[];
  if (!rows.length) {
    return (
      <EmptyState
        icon={<ScrollText className="size-5" />}
        title="No requests yet"
        body="Ask for a quote and a named broker will prepare options from participating insurers."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/account/requests/new" className={buttonClass("primary")}>Get a quote</Link>
            <Link href="/get-started" className={buttonClass("secondary")}>Help me choose</Link>
          </div>
        }
      />
    );
  }
  const open = rows.filter((r) => (OPEN_REQUEST_STATUSES as string[]).includes(r.status) || r.status === "draft");
  const past = rows.filter((r) => !open.includes(r));
  return (
    <div className="space-y-10">
      <Section title="In progress" rows={open} empty="Nothing in progress right now." />
      {past.length > 0 && <Section title="Past requests" rows={past} />}
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: (RequestWithRefs & { request_tasks: { status: string; assignee_party: string }[] })[]; empty?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="border-b border-line pb-3 text-lg font-semibold text-ink">{title}</h2>
      {rows.length === 0 && empty && <p className="py-5 text-sm text-muted">{empty}</p>}
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const todo = r.request_tasks.filter((t) => t.status === "open" && t.assignee_party === "customer").length;
          const due = r.due_at && (OPEN_REQUEST_STATUSES as string[]).includes(r.status) ? relativeDue(r.due_at) : null;
          return (
            <li key={r.id}>
              <Link href={`/account/requests/${r.id}`} className="flex items-center gap-4 py-4 hover:bg-mist/50 sm:px-1">
                <CategoryIcon icon={r.category?.icon} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {r.title ?? r.category?.name} <span className="font-normal text-muted">· {REQUEST_TYPE_LABEL[r.type] ?? r.type}</span>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {r.reference} · Opened {formatDate(r.created_at)}
                    {r.broker ? ` · ${r.broker.name}` : ""}
                  </p>
                  {(todo > 0 || r.next_step) && (
                    <p className="mt-0.5 truncate text-sm text-ink-2">
                      {todo > 0 ? <span className="font-medium text-amber">{todo} item{todo === 1 ? "" : "s"} needed from you · </span> : null}
                      {r.next_step}
                    </p>
                  )}
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <StatusPill meta={REQUEST_STATUS[r.status]} />
                  {due && !due.overdue && <span className="text-xs text-subtle">Next update {due.label.toLowerCase()}</span>}
                </div>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
