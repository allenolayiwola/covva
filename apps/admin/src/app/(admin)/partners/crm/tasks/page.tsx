import { Suspense } from "react";
import Link from "next/link";
import { Pill, Tabs } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { taskDueState } from "@im/core";
import { requireCrm, staffDirectory } from "@/lib/crm";
import { sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { Kpi, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ToggleForm } from "@/components/ui/forms";
import { toggleTask } from "../actions";
import { CRM_BASE, STAGE_LABEL, STAGE_TONE, accountHref } from "../meta";
import type { CrmStage } from "@im/core";

export default function CrmTasksPage({ searchParams }: PageProps<"/partners/crm/tasks">) {
  return (
    <>
      <PageHeader eyebrow="Partnerships" title="Tasks" description="Follow-ups across your accounts. Due and overdue tasks are reminded once a day at 06:00 (in-app and email)." />
      <Suspense fallback={<LoadingBlock label="Loading tasks…" />}>
        <TaskList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
  assignee_id: string | null;
  account: { id: string; name: string; stage: string } | null;
};

async function TaskList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, supabase } = await requireCrm();
  const params = await searchParams;
  const scope = sp(params, "scope") === "all" ? "all" : "mine";
  let open = supabase.from("crm_tasks").select("id, title, due_at, done_at, assignee_id, account:crm_accounts(id, name, stage)").is("done_at", null).order("due_at", { ascending: true, nullsFirst: false }).limit(300);
  let recent = supabase.from("crm_tasks").select("id, title, due_at, done_at, assignee_id, account:crm_accounts(id, name, stage)").not("done_at", "is", null).order("done_at", { ascending: false }).limit(15);
  if (scope === "mine") {
    open = open.eq("assignee_id", actor.staff.userId);
    recent = recent.eq("assignee_id", actor.staff.userId);
  }
  const [{ data: openRows }, { data: doneRows }, staff] = await Promise.all([open, recent, staffDirectory(supabase, actor.staff.orgId)]);
  const staffById = new Map(staff.map((m) => [m.userId, m.name]));
  const now = new Date();
  const groups: Record<"overdue" | "today" | "upcoming" | "none", TaskRow[]> = { overdue: [], today: [], upcoming: [], none: [] };
  for (const t of (openRows ?? []) as unknown as TaskRow[]) groups[taskDueState(t.due_at, now)].push(t);

  return (
    <>
      <ReadOnlyBanner show={!actor.canWrite} />
      <Tabs
        items={[
          { key: "mine", label: "My tasks", href: `${CRM_BASE}/tasks`, count: scope === "mine" ? (openRows ?? []).length : undefined },
          { key: "all", label: "Everyone", href: `${CRM_BASE}/tasks?scope=all` },
        ]}
        active={scope}
        className="mb-4 w-fit max-w-full"
      />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Kpi label="Overdue" value={groups.overdue.length} tone={groups.overdue.length ? "danger" : "ok"} />
        <Kpi label="Due today" value={groups.today.length} tone={groups.today.length ? "warn" : "default"} />
        <Kpi label="Upcoming" value={groups.upcoming.length + groups.none.length} />
      </div>
      <div className="space-y-6">
        <TaskGroup title="Overdue" items={groups.overdue} tone="danger" canAct={actor.canWrite} staffById={staffById} showAssignee={scope === "all"} />
        <TaskGroup title="Due today" items={groups.today} tone="wait" canAct={actor.canWrite} staffById={staffById} showAssignee={scope === "all"} />
        <TaskGroup title="Upcoming" items={groups.upcoming} tone="info" canAct={actor.canWrite} staffById={staffById} showAssignee={scope === "all"} />
        <TaskGroup title="No due date" items={groups.none} tone="neutral" canAct={actor.canWrite} staffById={staffById} showAssignee={scope === "all"} />
        <TaskGroup title="Recently completed" items={(doneRows ?? []) as unknown as TaskRow[]} tone="ok" canAct={actor.canWrite} staffById={staffById} showAssignee={scope === "all"} done />
      </div>
    </>
  );
}

function TaskGroup({
  title,
  items,
  tone,
  canAct,
  staffById,
  showAssignee,
  done = false,
}: {
  title: string;
  items: TaskRow[];
  tone: "danger" | "wait" | "info" | "neutral" | "ok";
  canAct: boolean;
  staffById: Map<string, string>;
  showAssignee: boolean;
  done?: boolean;
}) {
  if (!items.length && done) return null;
  return (
    <Panel title={<span className="flex items-center gap-2">{title} <Pill tone={tone}>{items.length}</Pill></span>} bodyClassName="p-0">
      {!items.length ? (
        <p className="px-5 py-6 text-sm text-muted">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((t) => (
            <li key={t.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
              <ToggleForm action={toggleTask} fields={{ taskId: t.id }} checked={!!t.done_at} label={`Mark "${t.title}" ${t.done_at ? "not done" : "done"}`} disabled={!canAct} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${t.done_at ? "text-muted line-through" : "text-ink"}`}>{t.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {t.account && (
                    <Link href={accountHref(t.account.id)} className="text-brand hover:underline">{t.account.name}</Link>
                  )}
                  {t.account && <Pill tone={STAGE_TONE[t.account.stage as CrmStage] ?? "neutral"}>{STAGE_LABEL[t.account.stage as CrmStage] ?? t.account.stage}</Pill>}
                  {t.due_at && <span>{done ? `done ${formatDateTime(t.done_at)}` : `due ${formatDateTime(t.due_at)}`}</span>}
                  {showAssignee && t.assignee_id && <span>· {staffById.get(t.assignee_id) ?? "staff"}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
