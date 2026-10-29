import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Avatar, Pill, buttonClass } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { CRM_ACCOUNT_KINDS, CRM_PIPELINE_STAGES, pipelineSummary, type CrmStage } from "@im/core";
import { requireCrm, staffDirectory, contactOf, type CrmAccount } from "@/lib/crm";
import { ilikeTerm, isUuid, sp, type SearchParams } from "@/lib/query";
import { formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, Kpi, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { CRM_BASE, KIND_LABEL, STAGE_LABEL, STAGE_TONE, accountHref } from "./meta";

export default function CrmPipelinePage({ searchParams }: PageProps<"/partners/crm">) {
  return (
    <>
      <PageHeader
        eyebrow="Partnerships"
        title="Partnerships CRM"
        description="Insurers, brokers, embedded partners and group schemes moving from first contact to live on Covva."
        actions={
          <>
            <Link href={`${CRM_BASE}/tasks`} className={buttonClass("outline", "sm")}>My tasks</Link>
            <Link href={`${CRM_BASE}/dashboard`} className={buttonClass("outline", "sm")}>Dashboard</Link>
            <Link href={`${CRM_BASE}/new`} className={buttonClass("primary", "sm")}><Plus className="size-4" aria-hidden /> New account</Link>
          </>
        }
      />
      <Suspense fallback={<LoadingBlock label="Loading pipeline…" rows={8} />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Board({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, supabase } = await requireCrm();
  const params = await searchParams;
  const kind = sp(params, "kind");
  const region = sp(params, "region");
  const q = sp(params, "q");
  // Reps land on their own accounts; everyone else (and reps who choose "Everyone") sees all.
  const owner = params.owner === undefined ? (actor.isRep ? "me" : "all") : (sp(params, "owner") ?? "all");

  let query = supabase.from("crm_accounts").select("*").order("updated_at", { ascending: false }).limit(500);
  if (kind && (CRM_ACCOUNT_KINDS as readonly string[]).includes(kind)) query = query.eq("kind", kind);
  if (owner === "me") query = query.eq("owner_user_id", actor.staff.userId);
  else if (owner === "unassigned") query = query.is("owner_user_id", null);
  else if (isUuid(owner)) query = query.eq("owner_user_id", owner);
  if (region) query = query.ilike("region", ilikeTerm(region));
  if (q) query = query.or(`name.ilike.${ilikeTerm(q)},contact->>name.ilike.${ilikeTerm(q)},contact->>email.ilike.${ilikeTerm(q)}`);

  const [{ data }, staff] = await Promise.all([query, staffDirectory(supabase, actor.staff.orgId)]);
  const accounts = (data ?? []) as CrmAccount[];
  const summary = pipelineSummary(accounts);
  const staffById = new Map(staff.map((m) => [m.userId, m]));
  const byStage = new Map<CrmStage, CrmAccount[]>();
  for (const a of accounts) byStage.set(a.stage as CrmStage, [...(byStage.get(a.stage as CrmStage) ?? []), a]);
  const lost = byStage.get("lost") ?? [];

  return (
    <>
      <ReadOnlyBanner show={!actor.canWrite} />
      <div className="mb-6 grid gap-3 grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open accounts" value={summary.open} hint={owner === "me" ? "Owned by you" : owner === "unassigned" ? "Without an owner" : "In the pipeline"} />
        <Kpi label="Pipeline value" value={formatGHS(summary.byStage.filter((s) => s.stage !== "live" && s.stage !== "lost").reduce((x, s) => x + s.value, 0))} hint="Estimated annual value of open accounts" />
        <Kpi label="Live partners" value={summary.live} tone="ok" href={`${CRM_BASE}/dashboard`} />
        <Kpi label="Lost" value={summary.lost} tone={summary.lost ? "warn" : "default"} hint={summary.winRate == null ? "No decided accounts yet" : `${Math.round(summary.winRate * 100)}% win rate`} />
      </div>

      <FilterBar action={CRM_BASE} resetHref={CRM_BASE}>
        <FilterInput name="q" label="Name or contact" value={q} />
        <FilterSelect name="kind" label="Kind" value={kind} options={CRM_ACCOUNT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <FilterSelect
          name="owner"
          label="Owner"
          value={owner === "all" ? "" : owner}
          allLabel="Everyone"
          options={[{ value: "me", label: "My accounts" }, { value: "unassigned", label: "Unassigned" }, ...staff.map((m) => ({ value: m.userId, label: m.name }))]}
        />
        <FilterInput name="region" label="Region" value={region} />
      </FilterBar>

      {/* Kanban: one column per stage; stacked on phones, horizontal scroll from md up. */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:overflow-x-auto md:pb-4" role="list" aria-label="Pipeline by stage">
        {CRM_PIPELINE_STAGES.map((stage) => {
          const items = byStage.get(stage) ?? [];
          const value = items.reduce((x, a) => x + Number(a.estimated_value ?? 0), 0);
          return (
            <section key={stage} role="listitem" aria-label={`${STAGE_LABEL[stage]} (${items.length})`} className="rounded-card border border-line bg-mist/60 md:w-72 md:shrink-0">
              <header className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>
                  <span className="text-sm font-semibold tabular-nums text-ink">{items.length}</span>
                </div>
                <span className="text-xs tabular-nums text-muted">{value ? formatGHS(value) : ""}</span>
              </header>
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {items.map((a) => <AccountCard key={a.id} account={a} owner={a.owner_user_id ? staffById.get(a.owner_user_id)?.name : undefined} />)}
                {!items.length && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-subtle">No accounts</li>}
              </ul>
            </section>
          );
        })}
      </div>

      <details className="mt-4 rounded-card border border-line bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Lost accounts ({lost.length})</summary>
        <ul className="grid gap-2 border-t border-line p-3 sm:grid-cols-2 xl:grid-cols-4">
          {lost.map((a) => <AccountCard key={a.id} account={a} owner={a.owner_user_id ? staffById.get(a.owner_user_id)?.name : undefined} />)}
          {!lost.length && <li className="text-sm text-muted">Nothing lost — yet.</li>}
        </ul>
      </details>
    </>
  );
}

function AccountCard({ account: a, owner }: { account: CrmAccount; owner?: string }) {
  const c = contactOf(a);
  return (
    <li>
      <Link href={accountHref(a.id)} className="block min-h-14 rounded-xl border border-line bg-white p-3 transition-colors hover:border-brand/50 active:bg-mist">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-snug text-ink">{a.name}</p>
          {owner ? <Avatar name={owner} size={26} /> : <span className="rounded-sm bg-amber-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-amber">Unowned</span>}
        </div>
        <p className="mt-1 text-xs text-muted">
          {KIND_LABEL[a.kind as keyof typeof KIND_LABEL] ?? a.kind}
          {a.region ? ` · ${a.region}` : ""}
          {c.name ? ` · ${c.name}` : ""}
        </p>
        <p className="mt-1.5 flex items-center justify-between text-xs text-subtle">
          <span>{a.estimated_value ? formatGHS(Number(a.estimated_value)) : "No value yet"}</span>
          <span>{a.stage === "lost" ? a.lost_reason?.slice(0, 40) : `Updated ${formatDate(a.updated_at)}`}</span>
        </p>
      </Link>
    </li>
  );
}
