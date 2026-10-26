"use client";
import { LogOut, ShieldCheck } from "lucide-react";
import { Avatar } from "@im/ui";
import { signOut } from "@/app/sign-in/actions";

export function UserMenu({ name, email, roleLabels, aal }: { name: string; email: string | null; roleLabels: string[]; aal: string | null }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-1.5 py-1 hover:bg-mist [&::-webkit-details-marker]:hidden">
        <Avatar name={name} size={32} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight text-ink">{name}</span>
          <span className="block text-xs leading-tight text-muted">{roleLabels[0]}</span>
        </span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-72 rounded-card border border-line bg-white p-4 shadow-float">
        <p className="text-sm font-semibold text-ink">{name}</p>
        {email && <p className="text-xs text-muted">{email}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {roleLabels.map((r) => (
            <span key={r} className="rounded-full bg-mint px-2 py-0.5 text-xs font-medium text-brand-deep">{r}</span>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5" aria-hidden />
          Session assurance: {aal === "aal2" ? "MFA verified (AAL2)" : "Password only (AAL1)"}
        </p>
        <form action={signOut} className="mt-4 border-t border-line pt-3">
          <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-mist">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
