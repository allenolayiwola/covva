import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { JsonLd } from "@/components/marketing/json-ld";
import { getBrand } from "@/components/marketing/brand";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
          logo: `${siteUrl}/icon`,
          email: brand.supportEmail,
          areaServed: { "@type": "Country", name: "Ghana" },
          description:
            "Technology platform for exploring, comparing and managing insurance in Ghana. Broking services are provided by licensed brokers; policies are issued by licensed insurers.",
        }}
      />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
