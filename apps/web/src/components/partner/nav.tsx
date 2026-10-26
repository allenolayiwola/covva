"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { cn } from "@im/ui";
import type { FormAction } from "./action-form";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

function isActive(pathname: string, href: string) {
  if (href === "/partner") return pathname === "/partner";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Left navigation (desktop) and horizontal scroller (mobile/tablet). */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((it) => {
        const active = isActive(pathname, it.href);
        return (
          <li key={it.href} className="shrink-0">
            <Link
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded-[10px] px-4 py-2.5 text-[15px] transition-colors",
                active ? "bg-mint font-semibold text-brand-deep" : "text-muted hover:bg-mist hover:text-ink",
              )}
            >
              <span>{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-amber-bg px-1.5 text-xs font-semibold text-amber">{it.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Org switcher shown only when the user belongs to several partner organisations. */
export function OrgSwitcher({ orgs, activeId, action }: { orgs: { id: string; name: string; kind: string }[]; activeId: string; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  return (
    <form action={formAction} className="flex items-center gap-2">
      <label htmlFor="org-switch" className="sr-only">Active organisation</label>
      <select
        id="org-switch"
        name="orgId"
        defaultValue={activeId}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 max-w-[14rem] truncate rounded-[10px] border border-line bg-white px-3 text-sm text-ink focus:border-brand focus:outline-none"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.kind === "insurer" ? "Insurer" : "Broker"}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
