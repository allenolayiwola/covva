import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Tabs, Notice } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, sp, type SearchParams } from "@/lib/query";
import { LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ToggleForm } from "@/components/ui/forms";
import { toggleAppointment } from "./actions";

export default function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  return (
    <>
      <PageHeader
        title="Appointments"
        description="Which brokers each insurer has appointed, per category. A broker can only place a risk with insurers that have appointed it."
      />
      <Suspense fallback={<LoadingBlock label="Loading appointments…" />}>
        <Matrix searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Matrix({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const [orgs, cats] = await Promise.all([orgMap(supabase), categoryMap(supabase)]);
  const catList = [...cats.values()];
  const category = sp(params, "category") ?? catList[0]?.id;
  if (!category) return <Notice>No categories yet.</Notice>;

  const { data: appts } = await supabase.from("insurer_broker_appointments").select("id, insurer_org_id, broker_org_id, category_id, active").eq("category_id", category);
  const key = (i: string, b: string) => `${i}:${b}`;
  const active = new Map((appts ?? []).map((a) => [key(a.insurer_org_id, a.broker_org_id), a.active]));
  const insurers = [...orgs.values()].filter((o) => o.type === "insurer" && o.status !== "offboarded");
  const brokers = [...orgs.values()].filter((o) => o.type === "broker" && o.status !== "offboarded");
  const { data: products } = await supabase.from("products").select("insurer_org_id").eq("category_id", category).eq("status", "approved");
  const hasProduct = new Set((products ?? []).map((p) => p.insurer_org_id));
  const canAct = can(staff.roles, "network");

  return (
    <>
      <Tabs className="mb-4" active={category} items={catList.map((c) => ({ key: c.id, label: c.name, href: `/appointments?category=${c.id}` }))} />
      <ReadOnlyBanner show={!canAct} />
      <div className="overflow-x-auto rounded-card border border-line bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-mist text-xs font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Insurer ↓ / Broker →</th>
              {brokers.map((b) => (
                <th key={b.id} className="px-4 py-3 text-center normal-case tracking-normal">
                  <Link href={`/organisations/${b.id}`} className="hover:text-brand">{b.name}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {insurers.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <Link href={`/organisations/${i.id}?tab=appointments`} className="font-medium text-ink hover:text-brand">{i.name}</Link>
                  <p className="text-xs text-muted">{hasProduct.has(i.id) ? "Approved product in category" : "No approved product in category"}</p>
                </td>
                {brokers.map((b) => (
                  <td key={b.id} className="px-4 py-3 text-center">
                    <ToggleForm
                      action={toggleAppointment}
                      fields={{ insurerOrgId: i.id, brokerOrgId: b.id, categoryId: category }}
                      checked={active.get(key(i.id, b.id)) === true}
                      label={`${i.name} appoints ${b.name} for ${cats.get(category)?.name}`}
                      disabled={!canAct}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!insurers.length && <tr><td colSpan={brokers.length + 1} className="px-4 py-8 text-center text-muted">No insurers.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-subtle">Withdrawing an appointment keeps the record (active = false, end date set). Every change is recorded in the audit log.</p>
    </>
  );
}
