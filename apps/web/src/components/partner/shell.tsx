import Link from "next/link";
import { Bell, ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, Pill } from "@im/ui";
import { formatDateTime } from "@im/core";
import { getPartnerContext, type PartnerContext } from "@/app/(site)/(partner)/partner/_lib/context";
import { markNotificationsRead, signOut, switchOrg } from "@/app/(site)/(partner)/partner/(workspace)/actions";
import { NavLinks, OrgSwitcher, type NavItem } from "./nav";
import { Skeleton } from "./ui";

export function brokerNav(): NavItem[] {
  return [
    { href: "/partner", label: "Overview" },
    { href: "/partner/requests", label: "Request queue" },
    { href: "/partner/offers", label: "Offers" },
    { href: "/partner/quotes", label: "Quotes" },
    { href: "/partner/customers", label: "Customers" },
    { href: "/partner/groups", label: "Welfare groups" },
    { href: "/partner/policies", label: "Policies" },
    { href: "/partner/endorsements", label: "Policy changes" },
    { href: "/partner/appointments", label: "Appointments" },
    { href: "/partner/service", label: "Service & claims" },
    { href: "/partner/whatsapp", label: "WhatsApp" },
    { href: "/partner/products/propose", label: "Rate proposals" },
    { href: "/partner/rewards", label: "Rewards & discounts" },
    { href: "/partner/scorecard", label: "Scorecard" },
    { href: "/partner/reports", label: "Reports" },
    { href: "/partner/reports/accounting", label: "Accounting exports" },
    { href: "/partner/settlements", label: "Settlements" },
    { href: "/partner/settings", label: "Team settings" },
  ];
}

export function insurerNav(): NavItem[] {
  return [
    { href: "/partner", label: "Overview" },
    { href: "/partner/submissions", label: "Submissions" },
    { href: "/partner/issuance", label: "Issuance" },
    { href: "/partner/endorsements", label: "Policy changes" },
    { href: "/partner/instalments", label: "Instalments" },
    { href: "/partner/claims", label: "Claims" },
    { href: "/partner/groups", label: "Welfare groups" },
    { href: "/partner/products", label: "Products" },
    { href: "/partner/rewards", label: "Rewards & discounts" },
    { href: "/partner/appointments", label: "Appointments" },
    { href: "/partner/integrations", label: "Integrations" },
    { href: "/partner/scorecard", label: "Broker scorecards" },
    { href: "/partner/insights", label: "Market insight" },
    { href: "/partner/reports", label: "Reports" },
    { href: "/partner/reports/accounting", label: "Accounting exports" },
    { href: "/partner/settlements", label: "Settlements" },
    { href: "/partner/settings", label: "Team settings" },
  ];
}

/** Embedded distribution partners (dealers, banks, landlords…): referrals only — no requests, quotes or claims. */
export function distributorNav(): NavItem[] {
  return [
    { href: "/partner", label: "Dashboard" },
    { href: "/partner/widget", label: "Widget" },
    { href: "/partner/links", label: "Links" },
    { href: "/partner/settings?tab=developer", label: "API keys" },
    { href: "/partner/revenue-share", label: "Statements" },
    { href: "/partner/settings", label: "Team settings" },
  ];
}

/** Left nav (needs the org type, so it streams). */
export async function SideNav() {
  const ctx = await getPartnerContext();
  if (ctx.kind === "distributor") return <NavLinks items={distributorNav()} />;
  const items = ctx.kind === "insurer" ? insurerNav() : brokerNav();
  // Inspection partners (organizations.settings.inspection_partner = true) also see property inspections.
  if ((ctx.membership.org.settings as { inspection_partner?: boolean } | null)?.inspection_partner === true) items.splice(items.length - 1, 0, { href: "/partner/inspections", label: "Inspections" });
  return <NavLinks items={items} />;
}

export function SideNavSkeleton() {
  return (
    <div className="flex gap-2 lg:flex-col">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-28 lg:w-full" />
      ))}
    </div>
  );
}

/** Bottom-left help card from the mockup. */
export async function HelpCard() {
  const ctx = await getPartnerContext();
  const { data: org } = await ctx.supabase.from("organizations").select("name, contact_email, contact_phone").eq("id", ctx.orgId).maybeSingle();
  const href = org?.contact_email ? `mailto:${org.contact_email}` : "/support";
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="font-semibold text-ink">{org?.name ?? ctx.orgName}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">Human help,<br />when you need it.</p>
      <a href={href} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Contact team →</a>
    </div>
  );
}

/** Right side of the top bar: org switcher, demo pill, notifications, user menu. */
export async function TopBarRight() {
  const ctx = await getPartnerContext();
  const { data: notes } = await ctx.supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(8);
  const unread = (notes ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {ctx.all.length > 1 && (
        <div className="hidden md:block">
          <OrgSwitcher orgs={ctx.all.map((m) => ({ id: m.org_id, name: m.org.name, kind: m.org.type }))} activeId={ctx.orgId} action={switchOrg} />
        </div>
      )}
      {ctx.isDemo && <Pill tone="ok" className="font-semibold">Demo</Pill>}
      <details className="group relative">
        <summary className="relative grid size-9 cursor-pointer list-none place-items-center rounded-full text-ink-2 hover:bg-mist [&::-webkit-details-marker]:hidden" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-5" aria-hidden />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-gold" />}
        </summary>
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-card border border-line bg-white p-2 shadow-float">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unread > 0 && (
              <form action={markNotificationsRead}>
                <button className="text-xs font-medium text-brand hover:underline">Mark all read</button>
              </form>
            )}
          </div>
          {(notes ?? []).length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted">You’re all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {(notes ?? []).map((n) => (
                <li key={n.id}>
                  <a href={n.link ?? "#"} className="block rounded-lg px-2 py-2 hover:bg-mist">
                    <p className={n.read_at ? "text-sm text-ink-2" : "text-sm font-semibold text-ink"}>{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-subtle">{formatDateTime(n.created_at)}</p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <UserMenu ctx={ctx} />
    </div>
  );
}

function UserMenu({ ctx }: { ctx: PartnerContext }) {
  const label = ctx.userEmail ?? "Account";
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full p-0.5 pr-2 hover:bg-mist [&::-webkit-details-marker]:hidden" aria-label="Account menu">
        <Avatar name={label} size={32} />
        <ChevronDown className="size-4 text-muted" aria-hidden />
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-line bg-white p-2 shadow-float">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-semibold text-ink">{label}</p>
          <p className="text-xs capitalize text-muted">
            {ctx.role.replace(/_/g, " ")} · {ctx.orgName}
            {ctx.membership.team ? ` · ${ctx.membership.team}` : ""}
          </p>
        </div>
        {ctx.all.length > 1 && (
          <div className="border-t border-line px-2 py-2 md:hidden">
            <OrgSwitcher orgs={ctx.all.map((m) => ({ id: m.org_id, name: m.org.name, kind: m.org.type }))} activeId={ctx.orgId} action={switchOrg} />
          </div>
        )}
        <Link href="/partner/settings/security" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-mist">
          <ShieldCheck className="size-4" aria-hidden /> Security &amp; devices
        </Link>
        <Link href="/account" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-mist">
          <UserRound className="size-4" aria-hidden /> My customer account
        </Link>
        <form action={signOut}>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink-2 hover:bg-mist">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
