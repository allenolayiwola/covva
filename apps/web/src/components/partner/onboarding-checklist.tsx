import Link from "next/link";
import { Pill, cn } from "@im/ui";
import type { PartnerContext } from "@/app/(site)/(partner)/partner/_lib/context";

export const CHECKLIST_ITEMS = [
  { key: "documents", label: "Documents" },
  { key: "verification", label: "NIC verification" },
  { key: "agreement", label: "Partner agreement" },
  { key: "products", label: "Products" },
  { key: "test_quote", label: "Test quote" },
  { key: "go_live", label: "Go live" },
] as const;
export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
export type ChecklistItem = { done?: boolean; at?: string; by?: string };
export type Checklist = Partial<Record<ChecklistKey, ChecklistItem>>;

export function checklistProgress(raw: unknown): { items: { key: ChecklistKey; label: string; done: boolean }[]; done: number; total: number } {
  const c = (raw && typeof raw === "object" ? raw : {}) as Checklist;
  const items = CHECKLIST_ITEMS.map((i) => ({ key: i.key, label: i.label, done: c[i.key]?.done === true }));
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

const HINTS: Record<ChecklistKey, { broker: string; insurer: string; href: string }> = {
  documents: { broker: "Licence and incorporation documents received.", insurer: "Licence and incorporation documents received.", href: "/partner/settings?tab=licence" },
  verification: { broker: "Covva verified your NIC licence on the register.", insurer: "Covva verified your NIC licence on the register.", href: "/partner/settings?tab=licence" },
  agreement: { broker: "Partner agreement signed.", insurer: "Partner agreement signed.", href: "/partner/settings?tab=terms" },
  products: { broker: "Get appointed by the insurers you place business with.", insurer: "Publish at least one product with rates and documents.", href: "/partner/products" },
  test_quote: { broker: "Run a test request end to end with Covva.", insurer: "Run a test quote through your products with Covva.", href: "/partner/reports" },
  go_live: { broker: "Covva switches routing on for your organisation.", insurer: "Covva switches routing on for your organisation.", href: "/partner/settings" },
};

/**
 * Onboarding checklist widget (Addendum 3 D): progress of documents → verification → agreement →
 * products → test quote → go-live, kept on organizations.onboarding_checklist by Covva staff.
 * Hidden once every item is done (or when the organisation predates the checklist).
 */
export async function OnboardingChecklist({ ctx }: { ctx: PartnerContext }) {
  const { data } = await ctx.supabase.from("organizations").select("onboarding_checklist, licence_status").eq("id", ctx.orgId).maybeSingle();
  const raw = (data?.onboarding_checklist ?? {}) as Record<string, unknown>;
  if (!Object.keys(raw).length) return null;
  const { items, done, total } = checklistProgress(raw);
  if (done === total) return null;
  return (
    <section aria-labelledby="onboarding-title" className="mb-6 rounded-card border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="onboarding-title" className="text-lg font-semibold tracking-tight text-ink">Onboarding checklist</h2>
          <p className="text-sm text-muted">{done} of {total} complete · your partnerships rep updates this as each step is confirmed.</p>
        </div>
        {data?.licence_status && data.licence_status !== "verified" && (
          <Pill tone={data.licence_status === "lapsed" ? "danger" : data.licence_status === "expiring" ? "wait" : "neutral"}>Licence {data.licence_status.replace(/_/g, " ")}</Pill>
        )}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i, idx) => {
          const hint = HINTS[i.key];
          const href = i.key === "products" && ctx.kind === "broker" ? "/partner/appointments" : hint.href;
          return (
            <li key={i.key} className={cn("flex gap-3 rounded-xl border p-3", i.done ? "border-transparent bg-mint/50" : "border-line")}>
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", i.done ? "bg-brand text-white" : "bg-mist text-muted")}>{i.done ? "✓" : idx + 1}</span>
              <div className="min-w-0">
                <Link href={href} className="text-sm font-semibold text-ink hover:text-brand">{i.label}</Link>
                <p className="text-xs text-muted">{ctx.kind === "insurer" ? hint.insurer : hint.broker}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
