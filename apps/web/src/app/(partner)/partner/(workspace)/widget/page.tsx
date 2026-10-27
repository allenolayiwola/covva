import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader, Pill } from "@im/ui";
import { EMBED_DISCLOSURE, PARTNER_SEGMENT_LABEL, widgetSnippet, type PartnerSegment } from "@im/core";
import { can, ROLES } from "../../_lib/context";
import { getDistributorContext, widgetCode } from "../../_lib/distribution";
import { ActionForm } from "@/components/partner/action-form";
import { CopyField } from "@/components/referrals/copy-field";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { siteUrl } from "@/server/api-auth";
import { createWidgetCode, saveWidgetSettings } from "./actions";
import { WidgetSettingsForm } from "./widget-form";

export const metadata: Metadata = { title: "Widget" };

export default function WidgetPage() {
  return (
    <>
      <PageHeader title="Quote widget" description="Embed Covva quotes on your website. Customers compare indicative prices and continue on Covva to sign up and buy." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Widget />
      </Suspense>
    </>
  );
}

async function Widget() {
  const { ctx, partner, links } = await getDistributorContext();
  if (!partner) return <Notice tone="info">Your distribution partnership is being set up by Covva. You will see the widget here once it is ready.</Notice>;
  const code = widgetCode(links);
  const canEdit = can(ctx, ROLES.orgAdmin);
  const category = partner.allowed_categories[0] ?? "motor";
  const base = siteUrl();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Pill tone={partner.status === "active" ? "ok" : partner.status === "suspended" ? "danger" : "wait"}>{partner.status}</Pill>
        <span>{PARTNER_SEGMENT_LABEL[partner.segment as PartnerSegment] ?? partner.segment}</span>
        <span>· Categories: {partner.allowed_categories.length ? partner.allowed_categories.join(", ") : "all available"}</span>
      </div>
      {partner.status !== "active" && <Notice tone="wait">The widget shows a “not available” message until Covva activates your partnership.</Notice>}

      <Section title="1. Copy the snippet" description="Paste it where the widget should appear. It adds a responsive iframe that resizes itself.">
        {code ? (
          <CopyField label="Embed snippet" multiline value={widgetSnippet(code, category, base)} />
        ) : canEdit ? (
          <ActionForm action={createWidgetCode} submitLabel="Create my widget code" />
        ) : (
          <Notice tone="info">An owner or admin needs to create the widget code.</Notice>
        )}
        <p className="mt-3 text-xs text-muted">Options: <code>data-category</code> (e.g. motor, travel, home), <code>data-max-width</code> (pixels). Payments never happen inside the widget — customers continue on Covva in a new tab.</p>
      </Section>

      <Section title="2. Allowed domains and branding">
        <WidgetSettingsForm action={saveWidgetSettings} domains={partner.widget_domains} colour={partner.brand?.primary_colour ?? ""} logo={partner.brand?.logo_url ?? ""} canEdit={canEdit} />
      </Section>

      {code && (
        <Section title="Live preview" description="Exactly what your customers see (the preview is allowed on Covva itself).">
          <div className="mx-auto max-w-md overflow-hidden rounded-card border border-line">
            <iframe title="Widget preview" src={`/embed/quote?partner=${code}&category=${encodeURIComponent(category)}`} className="h-[640px] w-full border-0" loading="lazy" />
          </div>
          <p className="mt-3 text-center text-xs text-muted">{EMBED_DISCLOSURE}</p>
        </Section>
      )}
    </div>
  );
}
