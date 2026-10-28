import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Bookmark, Compass, FileText, Plus, RefreshCw, Sparkles } from "lucide-react";
import { OPEN_REQUEST_STATUSES, POLICY_STATUS, REQUEST_STATUS, daysUntil, formatDate, formatGHS } from "@im/core";
import { Card, EmptyState, Notice, Pill, StatusPill, buttonClass } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { getFlags } from "@/lib/catalog";
import { BrokerRow, type BrokerOrgLite } from "@/components/customer/broker-card";
import { CategoryIcon } from "@/components/customer/category-icon";
import { PageSkeleton } from "@/components/customer/skeletons";
import { firstName } from "@/components/customer/utils";
import { CATEGORY_COLS, ORG_COLS, POLICY_SELECT, account, coverLabel, policyTitle, type CategoryLite, type OrgLite, type PolicyWithRefs } from "./_lib/data";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage({ searchParams }: PageProps<"/account">) {
  return (
    <Suspense fallback={<PageSkeleton hero rows={3} />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

type OpenRequest = {
  id: string;
  reference: string;
  title: string | null;
  status: keyof typeof REQUEST_STATUS;
  type: string;
  created_at: string;
  related_policy_id: string | null;
  category: CategoryLite | null;
  broker: OrgLite | null;
  quotes: { status: string }[];
};

type OpenTask = {
  id: string;
  title: string;
  document_kind: string | null;
  kind: string;
  request: { id: string; reference: string; title: string | null } | null;
};

async function Overview({ searchParams }: Pick<PageProps<"/account">, "searchParams">) {
  const { user, supabase } = await account("/account");
  const sp = await searchParams;
  const [profile, flags, policiesRes, requestsRes, tasksRes] = await Promise.all([
    getProfile(),
    getFlags(),
    supabase.from("policies").select(POLICY_SELECT).eq("customer_id", user.id).order("cover_end", { ascending: true, nullsFirst: false }),
    supabase
      .from("requests")
      .select(`id, reference, title, status, type, created_at, related_policy_id, category:product_categories(${CATEGORY_COLS}), broker:organizations!requests_broker_org_id_fkey(${ORG_COLS}), quotes(status)`)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("request_tasks")
      .select("id, title, document_kind, kind, request:requests!inner(id, reference, title, customer_id)")
      .eq("status", "open")
      .eq("assignee_party", "customer")
      .eq("request.customer_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const policies = (policiesRes.data ?? []) as unknown as PolicyWithRefs[];
  const requests = (requestsRes.data ?? []) as unknown as OpenRequest[];
  const tasks = (tasksRes.data ?? []) as unknown as OpenTask[];
  const openRequests = requests.filter((r) => (OPEN_REQUEST_STATUSES as string[]).includes(r.status));
  // "Resume later": a saved request with quotes ready is the saved comparison.
  const savedQuotes = requests.find((r) => r.status === "quotes_ready") ?? null;

  const live = policies.filter((p) => p.status === "active" || p.status === "pending_issuance");
  const active = policies.filter((p) => p.status === "active");
  const hero = active.find((p) => !p.external_source) ?? active[0] ?? live[0] ?? null;
  const renewal = active
    .map((p) => ({ p, days: daysUntil(p.cover_end) }))
    .filter((x): x is { p: PolicyWithRefs; days: number } => x.days !== null && x.days >= 0 && x.days <= 60)
    .sort((a, b) => a.days - b.days)[0];

  const tasksByRequest = new Map<string, OpenTask[]>();
  for (const t of tasks) {
    if (!t.request) continue;
    tasksByRequest.set(t.request.id, [...(tasksByRequest.get(t.request.id) ?? []), t]);
  }
  const firstTask = tasks[0];

  const brokerSource: { broker: BrokerOrgLite | null; requestId?: string } =
    requests.find((r) => r.broker) ? { broker: requests.find((r) => r.broker)!.broker, requestId: requests.find((r) => r.broker)!.id } :
    policies.find((p) => p.broker) ? { broker: policies.find((p) => p.broker)!.broker } : { broker: null };

  const hour = new Date().getUTCHours(); // Ghana is on GMT all year
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = profile?.preferred_name || firstName(profile?.full_name);
  const isEmpty = policies.length === 0 && requests.length === 0;

  return (
    <div className="space-y-10">
      <header>
        <p className="text-[15px] text-muted">{greeting}, {name}</p>
        <h1 className="mt-1 text-[32px] font-bold leading-tight tracking-tight text-ink sm:text-[40px]">Your cover at a glance</h1>
      </header>

      {sp.password === "updated" && <Notice tone="ok">Your password has been updated.</Notice>}

      {isEmpty ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="Let's find the right cover for you"
          body="Answer a few questions and we'll suggest the cover that fits your life — or explore categories and request quotes from participating insurers. A named broker helps you all the way."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/get-started" className={buttonClass("primary")}>Help me choose</Link>
              <Link href="/explore" className={buttonClass("secondary")}>
                <Compass aria-hidden className="size-4" /> Explore cover
              </Link>
              <Link href="/account/policies/new" className={buttonClass("ghost")}>Add a policy you already have</Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
          {hero ? (
            <HeroPolicy policy={hero} demo={!!flags.demo_mode} />
          ) : (
            <div className="relative overflow-hidden rounded-card bg-brand-dark p-6 text-white">
              <div aria-hidden className="pointer-events-none absolute -right-14 -top-14 size-52 rounded-full bg-white/8" />
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/75">No active cover yet</p>
              <p className="mt-2 text-[22px] font-semibold leading-snug">Your requests are in progress</p>
              <p className="mt-1 text-sm text-white/80">Cover starts only after the insurer confirms acceptance and issues your documents.</p>
              <Link href="/account/requests" className={buttonClass("white", "sm", "mt-5")}>View requests</Link>
            </div>
          )}

          {renewal ? (
            <Card className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <RefreshCw aria-hidden className="size-5 text-amber" />
                <Pill tone="wait">Renewal approaching</Pill>
              </div>
              <p className="mt-4 text-[34px] font-bold leading-none tracking-tight text-ink">{renewal.days} day{renewal.days === 1 ? "" : "s"}</p>
              <p className="mt-1.5 text-sm text-muted">until your {renewal.p.category?.name.toLowerCase() ?? ""} cover ends</p>
              <Link href={`/account/policies/${renewal.p.id}/renew`} className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand hover:underline">
                Request renewal options <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Card>
          ) : (
            <Card className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <RefreshCw aria-hidden className="size-5 text-brand" />
                <Pill tone="ok">No renewals due</Pill>
              </div>
              <p className="mt-4 text-[34px] font-bold leading-none tracking-tight text-ink">{active.length}</p>
              <p className="mt-1.5 text-sm text-muted">active polic{active.length === 1 ? "y" : "ies"} in your wallet</p>
              <Link href="/account/policies" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand hover:underline">
                Open my wallet <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Card>
          )}

          {firstTask?.request ? (
            <Card className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <FileText aria-hidden className="size-5 text-brand" />
                <Pill tone="wait">Action needed</Pill>
              </div>
              <p className="mt-4 text-[34px] font-bold leading-none tracking-tight text-ink">
                {tasksByRequest.size} request{tasksByRequest.size === 1 ? "" : "s"}
              </p>
              <p className="mt-1.5 text-sm text-muted">
                {tasksByRequest.size === 1 ? "needs" : "need"} {taskPhrase(firstTask)}
                {tasks.length > 1 ? ` and ${tasks.length - 1} more item${tasks.length > 2 ? "s" : ""}` : ""}
              </p>
              <Link href={`/account/requests/${firstTask.request.id}`} className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand hover:underline">
                {firstTask.kind === "document" ? "Upload document" : "Open request"} <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Card>
          ) : (
            <Card className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <FileText aria-hidden className="size-5 text-brand" />
                <Pill tone="ok">Nothing needed</Pill>
              </div>
              <p className="mt-4 text-[34px] font-bold leading-none tracking-tight text-ink">{openRequests.length}</p>
              <p className="mt-1.5 text-sm text-muted">open request{openRequests.length === 1 ? "" : "s"} with your broker</p>
              <Link href="/account/requests" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand hover:underline">
                Track requests <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Card>
          )}
        </div>
      )}

      {!isEmpty && (
        <section aria-labelledby="my-policies">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <h2 id="my-policies" className="text-[22px] font-semibold tracking-tight text-ink">My policies</h2>
            <div className="flex flex-wrap items-center gap-4">
              {savedQuotes && (
                <Link href={`/account/requests/${savedQuotes.id}/quotes`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                  <Bookmark aria-hidden className="size-4" /> Saved quotes
                </Link>
              )}
              <Link href="/account/requests/new" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                <Plus aria-hidden className="size-4" /> Get a new quote
              </Link>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {live.map((p) => (
              <li key={p.id}>
                <Link href={`/account/policies/${p.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 py-4 hover:bg-mist/50 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:px-1">
                  <CategoryIcon icon={p.category?.icon} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{policyTitle(p)}</p>
                    <p className="truncate text-sm text-muted">
                      {p.insurer?.name ?? "Insurer"} · {p.policy_number ?? p.internal_reference}
                    </p>
                  </div>
                  <p className="hidden text-right font-medium text-ink sm:block">{p.premium ? `${formatGHS(Number(p.premium))} / ${p.billing_period === "month" ? "mo" : "yr"}` : "—"}</p>
                  <p className="hidden w-36 text-right text-sm text-muted sm:block">{p.cover_end ? `Ends ${formatDate(p.cover_end)}` : "—"}</p>
                  <span className="justify-self-end">
                    <StatusPill meta={POLICY_STATUS[p.status]} />
                  </span>
                </Link>
              </li>
            ))}
            {openRequests
              .filter((r) => r.type !== "endorsement")
              .map((r) => {
                const awaiting = r.quotes.some((q) => q.status === "awaiting_underwriting");
                const meta = awaiting && r.status === "insurer_response" ? { label: "Awaiting underwriting", tone: "wait" as const } : REQUEST_STATUS[r.status];
                return (
                  <li key={r.id}>
                    <Link href={`/account/requests/${r.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 py-4 hover:bg-mist/50 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:px-1">
                      <CategoryIcon icon={r.category?.icon} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{r.title ?? r.category?.name ?? "Request"}</p>
                        <p className="truncate text-sm text-muted">
                          {coverLabel(r.category?.name, null)} · {r.reference}
                        </p>
                      </div>
                      <p className="hidden text-right font-medium text-ink sm:block">{r.status === "quotes_ready" ? "Quotes ready" : "Quote pending"}</p>
                      <p aria-hidden className="hidden w-36 text-right text-sm text-subtle sm:block">—</p>
                      <span className="justify-self-end">
                        <StatusPill meta={meta} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            {live.length === 0 && openRequests.length === 0 && (
              <li className="py-6 text-sm text-muted">
                No active policies yet. <Link href="/account/requests/new" className="font-medium text-brand hover:underline">Get a quote</Link> or{" "}
                <Link href="/account/policies/new" className="font-medium text-brand hover:underline">add a policy you bought elsewhere</Link>.
              </li>
            )}
          </ul>
          {brokerSource.broker && (
            <div className="mt-2 border-t border-line pt-5">
              <BrokerRow broker={brokerSource.broker} messageHref={brokerSource.requestId ? `/account/requests/${brokerSource.requestId}/messages` : "/account/messages"} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function taskPhrase(t: OpenTask) {
  if (t.kind === "document" && t.document_kind) return `your ${t.document_kind.replace(/_/g, " ")}`;
  return t.title.charAt(0).toLowerCase() + t.title.slice(1);
}

function HeroPolicy({ policy: p, demo }: { policy: PolicyWithRefs; demo: boolean }) {
  const items = (p.insured_items ?? {}) as Record<string, unknown>;
  return (
    <div className="relative overflow-hidden rounded-card bg-brand-dark p-6 text-white">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-10 size-60 rounded-full bg-white/8" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-10 size-52 rounded-full bg-white/5" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/75">{coverLabel(p.category?.name, items) || "Policy"}</p>
          {p.status !== "active" && <Pill tone="wait">{POLICY_STATUS[p.status].label}</Pill>}
        </div>
        <p className="mt-2 text-[24px] font-semibold leading-snug">{policyTitle(p)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/85">
          {p.insurer?.brand_color && <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: p.insurer.brand_color }} />}
          {p.insurer?.name ?? "Insurer"} · {p.policy_number ?? p.internal_reference}
          {demo && (p.insurer?.settings as { demo?: boolean } | null)?.demo && <span className="rounded bg-white/15 px-1.5 text-[11px]">Demo</span>}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/account/policies/${p.id}#documents`} className={buttonClass("white", "sm")}>View documents</Link>
          <Link href={`/account/claims/new?policy=${p.id}`} className={buttonClass("ghost", "sm", "bg-white/15 text-white hover:bg-white/25")}>Report a claim</Link>
        </div>
      </div>
    </div>
  );
}
