import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@im/ui";
import { getSetting } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UUID_RE, account } from "../../_lib/data";
import { ComplaintForm } from "./form";

export const metadata: Metadata = { title: "Make a complaint" };

export default function NewComplaintPage({ searchParams }: PageProps<"/account/complaints/new">) {
  return (
    <div className="max-w-3xl">
      <Breadcrumbs items={[{ label: "Complaints", href: "/account/complaints" }, { label: "New" }]} />
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/account/complaints/new">, "searchParams">) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" && UUID_RE.test(sp[k] as string) ? (sp[k] as string) : undefined);
  const { user, supabase } = await account("/account/complaints/new");
  const [{ data: reqs }, { data: pols }, { data: clms }, sla] = await Promise.all([
    supabase.from("requests").select("id, reference, title").eq("customer_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("policies").select("id, nickname, policy_number, internal_reference").eq("customer_id", user.id).limit(50),
    supabase.from("claims").select("id, reference, incident_type").eq("customer_id", user.id).order("created_at", { ascending: false }).limit(50),
    getSetting<number>("complaint_sla_days"),
  ]);
  const party = sp.against === "insurer" || sp.against === "platform" || sp.against === "broker" ? sp.against : undefined;
  return (
    <>
      <PageHeader
        title="Make a complaint"
        description={`We send it to the right firm straight away. They aim to resolve complaints within ${sla ?? 14} days and must keep you updated.`}
      />
      <ComplaintForm
        requests={(reqs ?? []).map((r) => ({ id: r.id, label: `${r.reference}${r.title ? ` · ${r.title}` : ""}` }))}
        policies={(pols ?? []).map((p) => ({ id: p.id, label: `${p.nickname ?? p.policy_number ?? p.internal_reference}` }))}
        claims={(clms ?? []).map((c) => ({ id: c.id, label: `${c.reference} · ${c.incident_type.replace(/_/g, " ")}` }))}
        defaults={{ requestId: pick("request"), policyId: pick("policy"), claimId: pick("claim"), againstParty: party }}
      />
    </>
  );
}
