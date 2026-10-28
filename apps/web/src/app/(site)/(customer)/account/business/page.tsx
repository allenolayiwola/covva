import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, CalendarClock, Car, FileSpreadsheet, HeartPulse, Plus, ReceiptText, Users } from "lucide-react";
import { INVOICE_STATUS, SCHEME_STATUS, businessCan, formatDate, formatGHS, humanize, type SchemeStatus } from "@im/core";
import { Card, EmptyState, Field, Input, Notice, PageHeader, Pill, Select, StatCard, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { businessDashboard, linkSchemeMemberships, myWorkplaceCover } from "@/server/business";
import { createSchemeAction } from "./actions";
import { BusinessNav, businessContext, one, withOrg } from "./_lib";

export const metadata: Metadata = { title: "Business" };

export default function BusinessPage({ searchParams }: PageProps<"/account/business">) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Business"
        description="Staff health and life schemes, fleet, property and liability for your business — one dashboard, one statement, every insurer paid directly."
        actions={
          <Link href="/account/business/new" className={buttonClass("secondary", "sm")}>
            <Plus aria-hidden className="size-4" /> New business account
          </Link>
        }
      />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business", sp);
  await linkSchemeMemberships(ctx.supabase);
  const cover = await myWorkplaceCover(ctx);

  if (!current) {
    return (
      <>
        {cover.length > 0 && <WorkplaceCover cover={cover} />}
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="Insurance for your business"
          body="Create a business account to set up group health or life cover for your staff, insure your fleet, property and liability, invite colleagues and pay one consolidated statement. Licensed brokers arrange the cover; each insurer is paid directly."
          action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>}
        />
      </>
    );
  }

  const dash = await businessDashboard(ctx, current.orgId);
  const manage = businessCan(current.role, "manage");
  return (
    <>
      <BusinessNav current={current} accounts={accounts} active="overview" />
      {one(sp.created) === "1" && (
        <Notice tone="ok" title="Business account created">
          Next: create a scheme and upload your staff list, add your vehicles, or invite a colleague from Team.
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members covered" value={dash.members.total} hint={dash.members.employees !== null ? `${dash.members.employees} employees` : `${dash.schemes.length} scheme${dash.schemes.length === 1 ? "" : "s"}`} />
        <StatCard label="Fleet vehicles" value={dash.fleet.active} hint={dash.fleet.active ? `${dash.fleet.insured} insured · ${formatGHS(dash.fleet.totalValue)}` : "None yet"} />
        <StatCard label="Property & assets" value={dash.assets.active} hint={dash.assets.active ? formatGHS(dash.assets.totalValue) : "None yet"} />
        <StatCard label="Employee claims" value={dash.claims.total} hint={dash.claims.open ? `${dash.claims.open} open` : "No open claims"} tone={dash.claims.open ? "warn" : "default"} />
      </div>

      <section aria-labelledby="schemes-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="schemes-title" className="text-lg font-semibold text-ink">Group schemes</h2>
          <Link href={withOrg("/account/business/members", current.orgId)} className="text-sm font-medium text-brand hover:underline">Members</Link>
        </div>
        {dash.schemes.length === 0 ? (
          <Card className="p-5 text-sm text-muted">No schemes yet. Create one for staff health, group life & funeral or personal accident cover.</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {dash.schemes.map((s) => {
              const meta = SCHEME_STATUS[s.status as SchemeStatus] ?? SCHEME_STATUS.draft;
              return (
                <Card as="li" key={s.id} className="p-4">
                  <Link href={withOrg(`/account/business/schemes/${s.id}`, current.orgId)} className="flex items-start justify-between gap-3 hover:text-brand">
                    <span>
                      <span className="block font-semibold text-ink">{s.name}</span>
                      <span className="block text-sm text-muted">{s.categoryName} · {s.memberCount} member{s.memberCount === 1 ? "" : "s"}{s.renewalDate ? ` · renews ${formatDate(s.renewalDate)}` : ""}</span>
                    </span>
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </Link>
                </Card>
              );
            })}
          </ul>
        )}
        {manage && (
          <details className="rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand">Create a scheme</summary>
            <ActionForm action={createSchemeAction} submitLabel="Create scheme" resetOnSuccess className="mt-3 space-y-3">
              <input type="hidden" name="orgId" value={current.orgId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Scheme name" htmlFor="scheme-name">
                  <Input id="scheme-name" name="name" required placeholder="Staff medical 2027" />
                </Field>
                <Field label="Type of cover" htmlFor="scheme-cat">
                  <Select id="scheme-cat" name="categorySlug" defaultValue="health">
                    <option value="health">Group health</option>
                    <option value="life-funeral">Group life & funeral</option>
                    <option value="personal-accident">Group personal accident</option>
                  </Select>
                </Field>
              </div>
            </ActionForm>
          </details>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="renewals-title">
          <h2 id="renewals-title" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><CalendarClock aria-hidden className="size-5 text-brand" /> Upcoming renewals</h2>
          {dash.renewals.length === 0 ? (
            <p className="text-sm text-muted">Nothing renews in the next 60 days.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {dash.renewals.map((r) => (
                <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-ink">{r.label}</span>
                  <Pill tone={r.days <= 14 ? "wait" : "neutral"}>{formatDate(r.date)} · {r.days} day{r.days === 1 ? "" : "s"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="invoices-title">
          <h2 id="invoices-title" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><ReceiptText aria-hidden className="size-5 text-brand" /> Statements due</h2>
          {dash.invoicesDue.length === 0 ? (
            <p className="text-sm text-muted">No statements due.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {dash.invoicesDue.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <Link href={withOrg("/account/business/invoices", current.orgId)} className="font-medium text-ink hover:text-brand">{i.reference} · {formatGHS(i.total, { decimals: true })}</Link>
                  <Pill tone={INVOICE_STATUS[i.status as keyof typeof INVOICE_STATUS]?.tone ?? "wait"}>{i.dueAt ? `due ${formatDate(i.dueAt)}` : humanize(i.status)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="quick-title">
        <h2 id="quick-title" className="sr-only">Quick links</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickLink href={withOrg("/account/business/members", current.orgId)} icon={<Users className="size-5" />} title="Members" body="Add staff and dependants or upload a CSV census." />
          <QuickLink href={withOrg("/account/business/fleet", current.orgId)} icon={<Car className="size-5" />} title="Fleet" body="Vehicles, drivers and fleet motor quotes." />
          <QuickLink href={withOrg("/account/business/assets", current.orgId)} icon={<FileSpreadsheet className="size-5" />} title="Property & liability" body="Premises, stock, equipment and liability exposures." />
        </div>
        {dash.openRequests > 0 && (
          <p className="mt-3 text-sm text-muted">
            {dash.openRequests} quote request{dash.openRequests === 1 ? "" : "s"} in progress — follow {dash.openRequests === 1 ? "it" : "them"} in <Link href="/account/requests" className="font-medium text-brand hover:underline">Requests</Link>.
          </p>
        )}
      </section>

      {cover.length > 0 && <WorkplaceCover cover={cover} />}
    </>
  );
}

function QuickLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="rounded-xl border border-line p-4 transition-colors hover:bg-mist">
      <span className="flex items-center gap-2 font-semibold text-ink"><span className="text-brand">{icon}</span>{title}</span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </Link>
  );
}

function WorkplaceCover({ cover }: { cover: Awaited<ReturnType<typeof myWorkplaceCover>> }) {
  return (
    <section aria-labelledby="workplace-title">
      <h2 id="workplace-title" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><HeartPulse aria-hidden className="size-5 text-brand" /> Your workplace cover</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cover.map((c) => (
          <Card as="li" key={c.memberId} className="p-4 text-sm">
            <p className="font-semibold text-ink">{c.schemeName}</p>
            <p className="text-muted">{c.businessName} · {c.categoryName}{c.coverTier ? ` · ${humanize(c.coverTier)}` : ""}</p>
            <p className="mt-1 text-muted">You are covered as {c.relationship === "employee" ? "an employee" : `a ${c.relationship}`}{c.insurerName ? ` · insurer ${c.insurerName}` : ""}{c.renewalDate ? ` · renews ${formatDate(c.renewalDate)}` : ""}</p>
          </Card>
        ))}
      </ul>
    </section>
  );
}

