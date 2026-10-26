import Link from "next/link";
import { Pill, Tabs } from "@im/ui";
import { humanize, issuanceLabel } from "@im/core";
import type { Row } from "@im/db";

const TONE: Record<string, "ok" | "wait" | "danger" | "neutral" | "info"> = { draft: "neutral", submitted: "wait", in_review: "info", returned: "danger", published: "ok" };

/** Header + tabs shared by the version workspace pages. */
export function VersionHeader({ product, version, active, isCurrent }: { product: Pick<Row<"products">, "id" | "name">; version: Row<"product_versions">; active: "overview" | "rates" | "rules" | "templates" | "simulate"; isCurrent: boolean }) {
  const base = `/partner/products/${product.id}/versions/${version.id}`;
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/products" className="hover:text-brand">Products</Link> <span aria-hidden>›</span>{" "}
        <Link href={`/partner/products/${product.id}`} className="hover:text-brand">{product.name}</Link> <span aria-hidden>›</span> v{version.version}
      </nav>
      <div className="mb-5">
        <h1 className="flex flex-wrap items-center gap-2 text-[28px] font-bold leading-tight tracking-tight text-ink">
          {product.name} <span className="text-muted">v{version.version}</span>
          {isCurrent && <Pill tone="ok">Current</Pill>}
          <Pill tone={TONE[version.compliance_status] ?? "neutral"}>{humanize(version.compliance_status)}</Pill>
        </h1>
        <p className="mt-1 text-sm text-muted">
          {humanize(version.status)} · issuance: {issuanceLabel(version.issuance_type, version.sla_hours)}
          {version.scheduled_effective_from ? ` · scheduled for ${new Date(version.scheduled_effective_from).toLocaleString("en-GB")}` : ""}
        </p>
      </div>
      <Tabs
        className="mb-6 w-fit"
        active={active}
        items={[
          { key: "overview", label: "Overview", href: base },
          { key: "rates", label: "Rate tables", href: `${base}/rates` },
          { key: "rules", label: "Underwriting rules", href: `${base}/rules` },
          { key: "templates", label: "Document templates", href: `${base}/templates` },
          { key: "simulate", label: "Quote simulator", href: `${base}/simulate` },
        ]}
      />
    </>
  );
}
