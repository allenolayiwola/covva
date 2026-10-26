import "server-only";
import { Mail, Phone } from "lucide-react";
import { Card, DemoBadge } from "@im/ui";
import { ROLE_STATEMENTS, issuanceLabel } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Transparency block (Addendum 2 G / Addendum 4 roadmap): on every quote/request and policy the
 * customer sees who the insurer is, who the broker of record is (or that there is none), how and
 * when the policy is issued, and where to complain. Rendered in the detail pages' side column.
 */
export interface PartyOrg {
  name: string;
  nic_licence_number?: string | null;
  settings?: unknown;
}

export interface TransactionPartiesProps {
  /** Participating insurer(s). Several while quotes are being compared; one once a quote is accepted. */
  insurers: PartyOrg[];
  /** Name of an insurer not on the platform (policy bought elsewhere). */
  externalInsurerName?: string | null;
  /** Broker of record, or null when the insurer sells directly. */
  broker: PartyOrg | null;
  /** Product version behind the accepted quote / policy — gives issuance type and SLA. */
  productVersionId?: string | null;
  /** "request" while quoting, "policy" once issued. Changes the issuance wording. */
  stage: "request" | "policy";
  /** True when the platform demo flag is on and the insurer is a demo partner. */
  isDemo?: boolean;
  className?: string;
}

interface ComplaintsSetting {
  email?: string | null;
  phone?: string | null;
  nic_name?: string | null;
  nic_phone?: string | null;
  nic_email?: string | null;
  nic_url?: string | null;
}

interface BrandSetting {
  support_email?: string;
  support_phone?: string;
}

/** Issuance type / SLA from `product_versions`, read defensively (the columns ship with the catalogue extensions). */
async function getIssuance(productVersionId: string | null | undefined): Promise<{ issuanceType: string | null; slaHours: number | null } | null> {
  if (!productVersionId) return null;
  const { data } = await createPublicClient().from("product_versions").select("*").eq("id", productVersionId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as { issuance_type?: unknown; sla_hours?: unknown };
  return {
    issuanceType: typeof row.issuance_type === "string" ? row.issuance_type : null,
    slaHours: typeof row.sla_hours === "number" ? row.sla_hours : null,
  };
}

function phoneHref(p: string) {
  return `tel:${p.replace(/[^+\d]/g, "")}`;
}

export async function TransactionParties(props: TransactionPartiesProps) {
  const [issuance, complaints, brand] = await Promise.all([
    getIssuance(props.productVersionId),
    getSetting<ComplaintsSetting>("complaints").catch(() => null),
    getSetting<BrandSetting>("brand").catch(() => null),
  ]);
  const complaintsEmail = complaints?.email || brand?.support_email || null;
  const complaintsPhone = [complaints?.phone, brand?.support_phone].find((p) => p && !p.startsWith("[")) ?? null;
  const nicName = complaints?.nic_name || "NIC Complaints Bureau";
  const nicUrl = complaints?.nic_url || "https://nic.gov.gh";
  const nicPhone = complaints?.nic_phone && !complaints.nic_phone.startsWith("[") ? complaints.nic_phone : null;

  const insurers = props.insurers.filter((i) => i.name);
  const insurerLine =
    insurers.length === 1
      ? insurers[0]!.name
      : insurers.length > 1
        ? `${insurers.length} participating insurers: ${insurers.map((i) => i.name).join(", ")}`
        : props.externalInsurerName
          ? `${props.externalInsurerName} (not on the platform)`
          : props.stage === "policy"
            ? "Insurer not listed"
            : "Decided when you choose a quote";

  const issuanceText = issuance
    ? issuanceLabel(issuance.issuanceType, issuance.slaHours)
    : props.stage === "policy"
      ? "Issued by the insurer after review"
      : "Shown with each quote before you pay";
  const expected =
    issuance?.issuanceType === "instant"
      ? "Documents are issued as soon as payment is confirmed."
      : issuance?.slaHours
        ? `The insurer's target is ${issuance.slaHours} hours from payment. Cover starts only once the policy is issued.`
        : "Cover starts only once the insurer confirms acceptance and issues the policy.";

  return (
    <Card className={props.className ?? "p-5"} aria-labelledby="transaction-parties">
      <h2 id="transaction-parties" className="text-sm font-semibold text-ink">Who&apos;s who on this {props.stage === "policy" ? "policy" : "request"}</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-subtle">Insurer</dt>
          <dd className="mt-0.5 font-medium text-ink">
            {insurerLine}
            {insurers.length === 1 && insurers[0]!.nic_licence_number && <span className="block text-xs font-normal text-muted">NIC licence {insurers[0]!.nic_licence_number}</span>}
            {props.isDemo && <DemoBadge className="mt-1" />}
          </dd>
          <dd className="text-xs text-muted">{ROLE_STATEMENTS.insurer}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-subtle">Broker of record</dt>
          {props.broker ? (
            <>
              <dd className="mt-0.5 font-medium text-ink">
                {props.broker.name}
                {props.broker.nic_licence_number && <span className="block text-xs font-normal text-muted">NIC licence {props.broker.nic_licence_number}</span>}
              </dd>
              <dd className="text-xs text-muted">{ROLE_STATEMENTS.broker}</dd>
            </>
          ) : (
            <dd className="mt-0.5 font-medium text-ink">
              No broker — issued directly by the insurer
              <span className="block text-xs font-normal text-muted">The insurer handles your questions, changes and claims directly.</span>
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-subtle">Issuance</dt>
          <dd className="mt-0.5 font-medium text-ink">{issuanceText}</dd>
          <dd className="text-xs text-muted">{expected}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-subtle">Complaints</dt>
          <dd className="mt-0.5 text-ink-2">
            Raise it with your {props.broker ? "broker or the insurer" : "insurer"} first. If it isn&apos;t resolved, contact the platform
            {complaintsEmail && (
              <>
                {" "}
                <a href={`mailto:${complaintsEmail}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Mail aria-hidden className="size-3.5" />{complaintsEmail}</a>
              </>
            )}
            {complaintsPhone && (
              <>
                {" "}
                <a href={phoneHref(complaintsPhone)} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone aria-hidden className="size-3.5" />{complaintsPhone}</a>
              </>
            )}
            , then the{" "}
            <a href={nicUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">{nicName}</a>
            {nicPhone && (
              <>
                {" "}
                <a href={phoneHref(nicPhone)} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone aria-hidden className="size-3.5" />{nicPhone}</a>
              </>
            )}
            .
          </dd>
          <dd className="text-xs text-muted">
            <a href="/legal/complaints" className="hover:underline">Our complaints procedure</a> · {ROLE_STATEMENTS.platform}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
