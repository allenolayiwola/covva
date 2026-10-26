import { Suspense } from "react";
import Link from "next/link";
import { LogoMark, Spinner } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { SidebarNav, MobileNav } from "@/components/shell/Sidebar";
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

async function Shell({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const env = envLabel();
  const name = staff.name || staff.email || "Staff";

  return (
    <div className="min-h-dvh">
      {!staff.mfaRequired && (
        <div role="alert" className="bg-danger px-4 py-1.5 text-center text-xs font-semibold text-white">
          MFA disabled — ADMIN_MFA_REQUIRED=false. Use only for local demos; never in production.
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
        <MobileNav />
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:inline">Insurance Marketplace</span>
          <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">Admin</span>
        </Link>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${env.tone}`} title="Environment">{env.label}</span>
        <div className="ml-auto flex items-center gap-2">
          <CommandPalette />
          <UserMenu name={name} email={staff.email} roleLabels={staff.roles.map((r) => ROLE_LABEL[r])} aal={staff.aal} />
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line bg-white lg:block">
          <SidebarNav />
          <p className="px-6 pb-6 text-[11px] leading-relaxed text-subtle">
            Technology provider console. The platform is not an insurer or broker and never holds premiums.
          </p>
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
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
