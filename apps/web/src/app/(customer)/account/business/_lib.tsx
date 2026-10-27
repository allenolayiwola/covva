import "server-only";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { businessRoleLabel } from "@im/core";
import { Tabs } from "@im/ui";
import { myBusinessAccounts, type BusinessAccount, type BusinessCtx } from "@/server/business";
import { account } from "../_lib/data";

/**
 * Business workspace context: the signed-in user (RLS client) and their business accounts. `?org=` picks the
 * account when the user belongs to several. Reads cookies — render inside <Suspense>.
 */
export async function businessContext(next: string, sp?: Record<string, string | string[] | undefined>) {
  const { user, supabase } = await account(next);
  const ctx: BusinessCtx = { supabase, userId: user.id, source: "web" };
  const accounts = await myBusinessAccounts(ctx);
  const wanted = typeof sp?.org === "string" ? sp.org : undefined;
  const current = accounts.find((a) => a.orgId === wanted) ?? accounts[0] ?? null;
  return { ctx, user, supabase, accounts, current };
}

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const withOrg = (path: string, orgId: string) => `${path}${path.includes("?") ? "&" : "?"}org=${orgId}`;

const TABS = [
  { key: "overview", label: "Dashboard", path: "/account/business" },
  { key: "members", label: "Members", path: "/account/business/members" },
  { key: "fleet", label: "Fleet", path: "/account/business/fleet" },
  { key: "assets", label: "Property & liability", path: "/account/business/assets" },
  { key: "invoices", label: "Statements", path: "/account/business/invoices" },
  { key: "team", label: "Team", path: "/account/business/team" },
] as const;

/** Business switcher + section tabs shown on every business page. */
export function BusinessNav({ current, accounts, active }: { current: BusinessAccount; accounts: BusinessAccount[]; active: (typeof TABS)[number]["key"] | "scheme" }) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Building2 aria-hidden className="size-4 text-brand" />
          <span className="font-semibold text-ink">{current.name}</span>
          <span>· {businessRoleLabel(current.role)}</span>
        </p>
        {accounts.length > 1 && (
          <nav aria-label="Switch business" className="flex flex-wrap gap-2 text-sm">
            {accounts.filter((a) => a.orgId !== current.orgId).map((a) => (
              <Link key={a.orgId} href={withOrg("/account/business", a.orgId)} className="font-medium text-brand hover:underline">Switch to {a.name}</Link>
            ))}
          </nav>
        )}
      </div>
      <Tabs active={active} items={TABS.map((t) => ({ key: t.key, label: t.label, href: withOrg(t.path, current.orgId) }))} />
    </div>
  );
}
