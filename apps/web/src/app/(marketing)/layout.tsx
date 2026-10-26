import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { JsonLd } from "@/components/marketing/json-ld";
import { getBrand } from "@/components/marketing/brand";
import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { ConsentBanner } from "@/components/marketing/consent-banner";
import { SmartAppBanner } from "@/components/marketing/smart-app-banner";
import { siteUrl as resolveSiteUrl } from "@/lib/site-url";
import { AnalyticsClicks } from "@/components/marketing/analytics-clicks";

const siteUrl = resolveSiteUrl();
const iosAppId = process.env.NEXT_PUBLIC_IOS_APP_ID;

/** Smart app banner for iOS (`apple-itunes-app`) when the App Store id is configured; Android uses <SmartAppBanner />. */
export const metadata: Metadata = iosAppId ? { itunes: { appId: iosAppId, appArgument: siteUrl } } : {};

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const brand = await getBrand();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: brand.name,
          slogan: brand.tagline,
          url: siteUrl,
          logo: `${siteUrl}/icon-512.png`,
          email: brand.supportEmail,
          areaServed: [{ "@type": "Country", name: "Ghana" }, { "@type": "Country", name: "United Kingdom" }, { "@type": "Country", name: "United States" }, { "@type": "Country", name: "Canada" }],
          sameAs: [],
          contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: brand.supportEmail, availableLanguage: ["en"] }],
          description:
            "Technology platform for comparing, buying and managing insurance in Ghana. Policies are arranged by licensed brokers and issued by licensed insurers. Covva is not an insurer or a broker.",
        }}
      />
      <SmartAppBanner />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
      <WhatsAppButton />
      <ConsentBanner />
      <AnalyticsClicks />
    </>
  );
}
