import { LogoMark } from "@im/ui";

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-mist px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <LogoMark size={36} />
          <span className="text-lg font-semibold tracking-tight text-ink">Insurance Marketplace</span>
          <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">Admin</span>
        </div>
        <div className="rounded-card border border-line bg-white p-6 shadow-float sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-subtle">All administrative actions are recorded in a tamper-evident audit log.</p>
      </div>
    </main>
  );
}
