import { Suspense } from "react";
import Link from "next/link";
import { Logo, Spinner } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { SidebarNav, MobileNav, ShellBreadcrumb } from "@/components/shell/Sidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { UserMenu } from "@/components/shell/UserMenu";

/**
 * Admin shell. The whole segment is staff-only and request-bound, so the shell
 * resolves the session inside <Suspense> (cookies are runtime data) and every page
 * re-checks with requireStaff() for its own data.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function envLabel(): { label: string; tone: string } {
  const env = process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  if (env === "production") return { label: "Production", tone: "bg-danger-bg text-danger" };
  if (env === "preview") return { label: "Preview", tone: "bg-amber-bg text-amber" };
  return { label: "Local", tone: "bg-info-bg text-info" };
}

const PROVIDER_NOTE = "Technology provider console. The platform is not an insurer or broker and never holds premiums.";

async function Shell({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const env = envLabel();
  const name = staff.name || staff.email || "Staff";
  const envBadge = (
    <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${env.tone}`} title="Environment">
      {env.label}
    </span>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      {!staff.mfaRequired && (
        <div role="alert" className="no-print bg-danger px-4 py-1.5 text-center text-xs font-semibold text-white">
          MFA disabled — ADMIN_MFA_REQUIRED=false. Use only for local demos; never in production.
        </div>
      )}
      <div className="flex">
        {/* Brand rail: dark teal sidebar with grouped, collapsible navigation (desktop). */}
        <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-rail text-rail-text lg:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-rail-line px-4">
            <Link href="/" className="flex items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight">
              <Logo reverse height={30} label="Covva admin home" />
            </Link>
            <span className="rounded-sm bg-white/12 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">Admin</span>
            <span className="ml-auto">{envBadge}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--color-rail-line)_transparent]">
            <SidebarNav />
          </div>
          <p className="shrink-0 border-t border-rail-line px-4 py-3 text-xs leading-relaxed text-rail-muted">{PROVIDER_NOTE}</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4 sm:px-6 lg:px-8">
            <MobileNav>
              <p className="mt-auto border-t border-rail-line px-5 py-4 text-xs leading-relaxed text-rail-muted">{PROVIDER_NOTE}</p>
            </MobileNav>
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <Logo height={28} label="Covva admin home" />
              <span className="hidden rounded-sm bg-ink px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white sm:inline">Admin</span>
            </Link>
            <span className="lg:hidden">{envBadge}</span>
            <ShellBreadcrumb />
            <div className="ml-auto flex items-center gap-2">
              <CommandPalette />
              <UserMenu name={name} email={staff.email} roleLabels={staff.roles.map((r) => ROLE_LABEL[r])} aal={staff.aal} />
            </div>
          </header>
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function ShellFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted">
      <Spinner className="size-5 text-brand" /> Loading admin console…
    </div>
  );
}
