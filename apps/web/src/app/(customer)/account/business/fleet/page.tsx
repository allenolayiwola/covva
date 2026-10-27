import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Car } from "lucide-react";
import { GHANA_REGIONS, businessCan, fleetCsvTemplate, formatGHS, groupComplexity, humanize } from "@im/core";
import { EmptyState, Field, Input, Notice, PageHeader, Pill, Select, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { listFleet } from "@/server/business";
import { addVehicleAction, importFleetAction, removeVehicleAction, requestFleetQuoteAction } from "../actions";
import { CsvImportForm } from "../csv-import";
import { BusinessNav, businessContext } from "../_lib";

export const metadata: Metadata = { title: "Business fleet" };

export default function FleetPage({ searchParams }: PageProps<"/account/business/fleet">) {
  return (
    <div className="space-y-8">
      <PageHeader title="Fleet" description="Your vehicles and drivers. Fleets of five or more vehicles are always handled by a licensed broker." />
      <Suspense fallback={<PageSkeleton rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const PREVIEW_COLUMNS = [
  { key: "registration", label: "Registration" },
  { key: "make", label: "Make" },
  { key: "model", label: "Model" },
  { key: "year", label: "Year" },
  { key: "value", label: "Value (GH₵)" },
  { key: "use", label: "Use" },
  { key: "driver_name", label: "Driver" },
];

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business/fleet", sp);
  if (!current) return <EmptyState title="No business account" body="Create a business account first." action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>} />;
  const fleet = await listFleet(ctx, current.orgId);
  const manage = businessCan(current.role, "manage");
  const size = groupComplexity([], fleet);
  const total = fleet.reduce((s, v) => s + (Number(v.value) || 0), 0);
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(fleetCsvTemplate)}`;
  return (
    <>
      <BusinessNav current={current} accounts={accounts} active="fleet" />
      <p className="text-sm text-muted">{fleet.length} active vehicle{fleet.length === 1 ? "" : "s"} · total value {formatGHS(total)}{size.flags.includes("fleet") ? " · fleet cover (broker-arranged)" : ""}</p>
      {fleet.length === 0 ? (
        <EmptyState icon={<Car className="size-5" />} title="No vehicles yet" body={manage ? "Add vehicles one by one or upload your fleet list below." : "Owners and admins add vehicles."} />
      ) : (
        <Table>
          <THead><tr><Th>Registration</Th><Th>Vehicle</Th><Th>Year</Th><Th>Value</Th><Th>Use</Th><Th>Driver</Th><Th>Cover</Th>{manage && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
          <tbody>
            {fleet.map((v) => (
              <tr key={v.id}>
                <Td className="font-semibold text-ink">{v.registration}</Td>
                <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
                <Td>{v.year ?? "—"}</Td>
                <Td>{v.value != null ? formatGHS(Number(v.value)) : "—"}</Td>
                <Td>{humanize(v.use)}</Td>
                <Td>{v.driver_name ?? "—"}</Td>
                <Td>{v.policy_id ? <Pill tone="ok">Insured</Pill> : <Pill tone="neutral">Not yet</Pill>}</Td>
                {manage && (
                  <Td>
                    <ActionForm action={removeVehicleAction} submitLabel="Remove" variant="ghost" size="sm" inline confirm={`Remove ${v.registration} from the fleet?`}>
                      <input type="hidden" name="vehicleId" value={v.id} />
                    </ActionForm>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {manage && fleet.length > 0 && (
        <section aria-labelledby="fleet-quote" className="rounded-xl border border-line p-5">
          <h2 id="fleet-quote" className="mb-1 text-lg font-semibold text-ink">Get fleet quotes</h2>
          <p className="mb-4 text-sm text-muted">A licensed broker reviews your fleet and approaches insurers. You compare quotes and pay each insurer directly.</p>
          <ActionForm action={requestFleetQuoteAction} submitLabel={`Request quotes for ${fleet.length} vehicle${fleet.length === 1 ? "" : "s"}`}>
            <input type="hidden" name="orgId" value={current.orgId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Cover" htmlFor="fq-cover">
                <Select id="fq-cover" name="coverType" defaultValue="comprehensive">
                  <option value="comprehensive">Comprehensive</option>
                  <option value="third_party_fire_theft">Third party, fire & theft</option>
                  <option value="third_party">Third party only</option>
                </Select>
              </Field>
              <Field label="Main region" htmlFor="fq-region">
                <Select id="fq-region" name="region" defaultValue={current.region ?? ""}>
                  <option value="">Choose…</option>
                  {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Notes for the broker" htmlFor="fq-notes"><Input id="fq-notes" name="notes" maxLength={1000} /></Field>
            </div>
          </ActionForm>
        </section>
      )}

      {manage ? (
        <>
          <section aria-labelledby="add-vehicle" className="rounded-xl border border-line p-5">
            <h2 id="add-vehicle" className="mb-3 text-lg font-semibold text-ink">Add a vehicle</h2>
            <ActionForm action={addVehicleAction} submitLabel="Add vehicle" resetOnSuccess>
              <input type="hidden" name="orgId" value={current.orgId} />
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Registration" htmlFor="v-reg"><Input id="v-reg" name="registration" required placeholder="GR 1234-23" /></Field>
                <Field label="Make" htmlFor="v-make"><Input id="v-make" name="make" /></Field>
                <Field label="Model" htmlFor="v-model"><Input id="v-model" name="model" /></Field>
                <Field label="Year" htmlFor="v-year"><Input id="v-year" name="year" inputMode="numeric" /></Field>
                <Field label="Value (GH₵)" htmlFor="v-value"><Input id="v-value" name="value" inputMode="decimal" /></Field>
                <Field label="Use" htmlFor="v-use">
                  <Select id="v-use" name="use" defaultValue="private">
                    <option value="private">Private</option>
                    <option value="commercial">Commercial</option>
                    <option value="hire">Hire & reward</option>
                  </Select>
                </Field>
                <Field label="Main driver" htmlFor="v-driver"><Input id="v-driver" name="driver_name" /></Field>
              </div>
            </ActionForm>
          </section>
          <section aria-labelledby="fleet-import" className="rounded-xl border border-line p-5">
            <h2 id="fleet-import" className="mb-1 text-lg font-semibold text-ink">Upload your fleet list</h2>
            <p className="mb-4 text-sm text-muted">Registrations are tidied automatically (GR123423 → GR 1234-23). Duplicates and vehicles already on your fleet are listed as problems.</p>
            <CsvImportForm action={importFleetAction} hidden={{ orgId: current.orgId }} label="Fleet (CSV)" hint="Columns: registration, make, model, year, value, use, driver_name · up to 900 KB" columns={PREVIEW_COLUMNS} noun="vehicle" templateHref={template} templateName="covva-fleet-template.csv" />
          </section>
        </>
      ) : (
        <Notice tone="info">Your role ({current.role}) can view the fleet. Owners and admins add vehicles and request quotes.</Notice>
      )}
    </>
  );
}
