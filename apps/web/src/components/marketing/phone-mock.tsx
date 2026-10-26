import { Camera, Check, ChevronRight, FileText, Heart, House, Phone, RotateCw } from "lucide-react";
import { cn } from "@im/ui";
import { displayOrgName } from "./brand";

/**
 * Phone-style "My cover" screen (from the mobile mockup), built in HTML/CSS.
 * Purely illustrative; hidden from assistive tech and described by the caller.
 */
export function PhoneMock({ insurers, className }: { insurers: string[]; className?: string }) {
  const [a = "Coastline General", b = "Volta Mutual", c = "Ashanti Shield"] = insurers.map(displayOrgName);
  return (
    <div aria-hidden className={cn("relative mx-auto w-[300px] select-none", className)}>
      <div className="rounded-[46px] bg-ink p-2.5 shadow-float ring-1 ring-black/10">
        <div className="relative overflow-hidden rounded-[38px] bg-white">
          <div className="flex items-center justify-between px-6 pt-3 text-[13px] font-semibold text-ink">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-ink" />
            <span className="flex gap-1">
              <span className="h-2.5 w-4 rounded-sm bg-ink" />
            </span>
          </div>
          <div className="px-4 pb-5 pt-3">
            <p className="mx-auto w-fit rounded-md bg-[#EEF2F1] px-2 py-0.5 text-[13px] text-muted">Illustrative only · Demo data</p>
            <p className="mt-2 text-[13px] text-muted">Good morning, Ama</p>
            <p className="text-[24px] font-bold leading-tight tracking-tight text-ink">My cover</p>

            <div className="relative mt-3 overflow-hidden rounded-[18px] bg-brand-dark p-4 text-white">
              <div className="absolute -right-8 -top-10 size-28 rounded-full bg-white/[0.08]" />
              <div className="absolute -bottom-12 right-6 size-24 rounded-full bg-white/[0.06]" />
              <div className="relative flex items-center justify-between">
                <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/90">Motor · Comprehensive</p>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[13px] font-medium text-brand-deep">
                  <Check className="size-2.5" strokeWidth={3} />
                  Active
                </span>
              </div>
              <p className="relative mt-2 text-[16px] font-semibold tracking-tight">Your everyday drive</p>
              <p className="relative text-[13px] text-white/90">{a} · DEMO-1048</p>
              <div className="relative mt-3 flex gap-6">
                <div>
                  <p className="text-[13px] text-white/90">Cover ends</p>
                  <p className="text-[13px] font-semibold">30 Nov 2026</p>
                </div>
                <div>
                  <p className="text-[13px] text-white/90">Premium</p>
                  <p className="text-[13px] font-semibold">GH₵ 2,400 / yr</p>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { icon: FileText, label: "Documents" },
                { icon: Camera, label: "Report claim" },
                { icon: Phone, label: "Call broker" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1 rounded-xl bg-mist py-2.5 text-[13px] font-medium text-brand-deep">
                  <Icon className="size-4" />
                  {label}
                </div>
              ))}
            </div>

            <p className="mt-4 text-[13px] font-semibold text-ink">Needs attention</p>
            <div className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-line p-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-amber-bg text-amber">
                <RotateCw className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">Renewal in 41 days</p>
                <p className="truncate text-[13px] text-muted">Review your needs with your broker</p>
              </div>
              <ChevronRight className="size-3.5 text-subtle" />
            </div>

            <p className="mt-4 text-[13px] font-semibold text-ink">All policies</p>
            <ul className="mt-1 divide-y divide-line">
              {[
                { icon: House, title: "Home contents", sub: `${b} · DEMO-2210`, pill: "Active", wait: false },
                { icon: Heart, title: "Family health", sub: `${c} · DEMO-3307`, pill: "Pending", wait: true },
              ].map(({ icon: Icon, title, sub, pill, wait }) => (
                <li key={title} className="flex items-center gap-2.5 py-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-mist text-brand-deep">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{title}</p>
                    <p className="truncate text-[13px] text-muted">{sub}</p>
                  </div>
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[13px] font-medium", wait ? "bg-amber-bg text-amber" : "bg-mint text-brand-dark")}>{pill}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
