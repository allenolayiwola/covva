import type { Metadata } from "next";
import { Suspense } from "react";
import type { RiskField } from "@im/core";
import { PageHeader } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { getCategories } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { UUID_RE, account, policyTitle } from "../../_lib/data";
import { RequestForm, type CategoryOption } from "./request-form";

export const metadata: Metadata = { title: "New request" };

const TYPES = ["new_cover", "renewal", "switch", "endorsement"] as const;
type ReqType = (typeof TYPES)[number];

const TITLES: Record<ReqType, { title: string; description: string }> = {
  new_cover: { title: "Get a quote", description: "Answer a few questions. A named broker prepares quotes from participating insurers." },
  renewal: { title: "Renew your cover", description: "Confirm your details so your broker can prepare renewal options." },
  switch: { title: "Switch insurer", description: "Your broker reviews alternatives. Nothing is cancelled until your replacement cover is confirmed." },
  endorsement: { title: "Request a change", description: "Tell your broker what has changed. The insurer confirms any change to your policy." },
};

export default function NewRequestPage({ searchParams }: PageProps<"/account/requests/new">) {
  return (
    <div className="max-w-3xl">
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/account/requests/new">, "searchParams">) {
  const sp = await searchParams;
  const { user, supabase } = await account("/account/requests/new");
  const type: ReqType = TYPES.includes(sp.type as ReqType) ? (sp.type as ReqType) : "new_cover";
  const policyParam = typeof sp.policy === "string" && UUID_RE.test(sp.policy) ? sp.policy : undefined;

  const [categories, profile] = await Promise.all([getCategories(), getProfile()]);

  let slug = typeof sp.category === "string" ? sp.category : undefined;
  let initialRisk: Record<string, unknown> | undefined;
  let policyLabel: string | undefined;
  let policyId: string | undefined;

  if (policyParam && type !== "new_cover") {
    const { data: pol } = await supabase
      .from("policies")
      .select("id, nickname, summary, policy_number, internal_reference, insured_items, request_id, category:product_categories(slug, name)")
      .eq("id", policyParam)
      .eq("customer_id", user.id)
      .maybeSingle();
    if (pol) {
      const cat = pol.category as unknown as { slug: string; name: string } | null;
      policyId = pol.id;
      slug = cat?.slug ?? slug;
      policyLabel = `${policyTitle({ ...pol, category: cat })} · ${pol.policy_number ?? pol.internal_reference}`;
      initialRisk = (pol.insured_items ?? {}) as Record<string, unknown>;
      if (pol.request_id) {
        const { data: req } = await supabase.from("requests").select("risk_data").eq("id", pol.request_id).maybeSingle();
        if (req?.risk_data && typeof req.risk_data === "object") initialRisk = { ...initialRisk, ...(req.risk_data as Record<string, unknown>) };
      }
    }
  }

  const options: CategoryOption[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    short_description: c.short_description,
    availability: c.availability,
    segment: c.segment,
    regulatory_note: c.regulatory_note,
    risk_schema: (c.risk_schema ?? []) as unknown as RiskField[],
  }));

  const t = TITLES[policyId ? type : "new_cover"];
  return (
    <>
      <Breadcrumbs items={[{ label: "Requests", href: "/account/requests" }, { label: t.title }]} />
      <PageHeader title={t.title} description={t.description} />
      <RequestForm
        categories={options}
        initialSlug={slug}
        type={policyId ? type : "new_cover"}
        policyId={policyId}
        policyLabel={policyLabel}
        initialRisk={initialRisk}
        defaultRegion={profile?.region ?? undefined}
      />
    </>
  );
}
