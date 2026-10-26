import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { daysUntil, formatDate, humanize } from "@im/core";
import { Notice } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { PageSkeleton } from "@/components/customer/skeletons";
import { account, getPolicyOr404, requestTime } from "../../../_lib/data";
import { RenewForm, type RenewToggle } from "./renew-form";

export const metadata: Metadata = { title: "Renew your cover" };

export default function RenewPage({ params }: PageProps<"/account/policies/[id]/renew">) {
  return (
    <div className="max-w-xl">
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Renew params={params} />
      </Suspense>
    </div>
  );
}

function DaysRing({ days }: { days: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0.04, Math.min(1, days / 60));
  return (
    <svg viewBox="0 0 100 100" className="size-24 shrink-0" role="img" aria-label={`${days} days left`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-mint)" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={days <= 14 ? "var(--color-gold)" : "var(--color-brand)"}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[26px] font-bold">
        {days}
      </text>
    </svg>
  );
}

function togglesFor(slug: string | undefined, risk: Record<string, unknown>, driver: string): RenewToggle[] {
  const s = (k: string) => (risk[k] != null && risk[k] !== "" ? String(risk[k]) : null);
  switch (slug) {
    case "motor": {
      const vehicle = [s("vehicle_make"), s("vehicle_model"), s("vehicle_year")].filter(Boolean).join(" ") || "Your insured vehicle";
      const use = risk.use === "commercial" ? "Commercial / ride-hailing" : "Private, no commercial use";
      return [
        { key: "same_vehicle", label: "Same vehicle", detail: vehicle, kind: "same", changeText: "I have a different vehicle", needsNewDetails: true },
        { key: "main_driver", label: "Main driver", detail: driver, kind: "same", changeText: "The main driver has changed", priceFactor: 1.05 },
        { key: "use", label: "Use", detail: use, kind: "same", changeText: "How the vehicle is used has changed", needsNewDetails: true },
        { key: "second_driver", label: "Add a second driver", detail: "Optional", kind: "add", changeText: "I'd like to add a second driver", priceFactor: 1.08 },
      ];
    }
    case "home":
      return [
        { key: "same_address", label: "Same address", detail: s("region") ?? "Your insured home", kind: "same", changeText: "I've moved home", needsNewDetails: true },
        { key: "same_values", label: "Same values", detail: "Rebuild and contents values are still right", kind: "same", changeText: "The values I insured have changed", needsNewDetails: true },
        { key: "valuables", label: "Add high-value items", detail: "Optional · jewellery, electronics", kind: "add", changeText: "I'd like to add high-value items", priceFactor: 1.06 },
      ];
    case "health":
    case "life-funeral":
      return [
        { key: "same_people", label: "Same people covered", detail: s("members") ? `${s("members")} people` : "As last year", kind: "same", changeText: "The people covered have changed", needsNewDetails: true },
        { key: "same_health", label: "No new medical conditions", detail: "Nothing new to declare", kind: "same", changeText: "There are new medical conditions to declare" },
        { key: "upgrade", label: "Upgrade my plan", detail: "Optional", kind: "add", changeText: "I'd like to discuss a higher plan level", priceFactor: 1.15 },
      ];
    default:
      return [
        { key: "same_cover", label: "Same cover needs", detail: "What I insure is unchanged", kind: "same", changeText: "What I need to insure has changed", needsNewDetails: true },
        { key: "same_details", label: "My details are the same", detail: "Address, business and contact details", kind: "same", changeText: "My details have changed" },
      ];
  }
}

async function Renew({ params }: Pick<PageProps<"/account/policies/[id]/renew">, "params">) {
  const { id } = await params;
  const { supabase } = await account(`/account/policies/${id}/renew`);
  const [policy, profile] = await Promise.all([getPolicyOr404(supabase, id), getProfile()]);
  const yearAgo = new Date(requestTime() - 365 * 86_400_000).toISOString();
  const [{ count: claims }, riskRes, openRenewal] = await Promise.all([
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("policy_id", id).gte("created_at", yearAgo).neq("status", "withdrawn"),
    policy.request_id ? supabase.from("requests").select("risk_data").eq("id", policy.request_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("requests").select("id, reference").eq("related_policy_id", id).eq("type", "renewal").not("status", "in", "(cancelled,closed_no_cover,completed)").limit(1),
  ]);
  const risk = { ...((policy.insured_items ?? {}) as Record<string, unknown>), ...((riskRes.data?.risk_data ?? {}) as Record<string, unknown>) };
  const days = daysUntil(policy.cover_end);
  const existing = openRenewal.data?.[0];

  return (
    <>
      <Link href={`/account/policies/${id}`} className="mb-2 inline-flex items-center gap-1 text-[15px] font-medium text-brand hover:underline">
        <ChevronLeft aria-hidden className="size-5" /> My cover
      </Link>
      <h1 className="text-[32px] font-bold leading-tight tracking-tight text-ink sm:text-[40px]">Renew your cover</h1>
      <p className="mt-1 text-[15px] text-muted">
        {policy.category?.name ?? humanize("policy")} · Policy {policy.policy_number ?? policy.internal_reference}
        {policy.cover_end ? ` · ends ${formatDate(policy.cover_end)}` : ""}
      </p>

      {days !== null && (
        <div className="mt-6 flex items-center gap-5">
          <DaysRing days={Math.max(0, days)} />
          <div>
            <p className="text-xl font-semibold text-ink">{days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : "Cover has ended"}</p>
            <p className="text-[15px] text-muted">Your broker starts preparing options 30 days before expiry.</p>
          </div>
        </div>
      )}

      {existing ? (
        <Notice tone="info" className="mt-8" title="Renewal already requested">
          Your broker is working on renewal request {existing.reference}.{" "}
          <Link href={`/account/requests/${existing.id}`} className="font-semibold underline">Track it</Link>
        </Notice>
      ) : (
        <div className="mt-8">
          <RenewForm
            policyId={policy.id}
            toggles={togglesFor(policy.category?.slug, risk, profile?.full_name ?? "You")}
            lastPremium={policy.premium ? Number(policy.premium) : null}
            claimsThisYear={claims ?? 0}
            messageHref={policy.request_id ? `/account/requests/${policy.request_id}/messages` : "/account/messages"}
          />
        </div>
      )}
    </>
  );
}
