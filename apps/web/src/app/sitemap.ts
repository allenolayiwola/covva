import type { MetadataRoute } from "next";
import { getCategories } from "@/lib/catalog";
import { PRODUCT_LINES } from "@/components/marketing/products-content";
import { ARTICLES } from "@/components/marketing/articles";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000")).replace(/\/$/, "");

const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/diaspora", priority: 0.9, changeFrequency: "weekly" },
  { path: "/explore", priority: 0.9, changeFrequency: "weekly" },
  { path: "/get-started", priority: 0.9, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/claims", priority: 0.8, changeFrequency: "monthly" },
  { path: "/verify", priority: 0.7, changeFrequency: "monthly" },
  { path: "/learn", priority: 0.8, changeFrequency: "weekly" },
  { path: "/business", priority: 0.7, changeFrequency: "monthly" },
  { path: "/brokers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/insurers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/partners/embedded", priority: 0.7, changeFrequency: "monthly" },
  { path: "/partners", priority: 0.6, changeFrequency: "weekly" },
  { path: "/referrals", priority: 0.6, changeFrequency: "monthly" },
  { path: "/waitlist", priority: 0.6, changeFrequency: "monthly" },
  { path: "/press", priority: 0.4, changeFrequency: "monthly" },
  { path: "/trust", priority: 0.6, changeFrequency: "monthly" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/complaints", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/disclosures", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.2, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const categories = await getCategories();
  return [
    ...STATIC_ROUTES.map((r) => ({ url: r.path === "/" ? siteUrl : `${siteUrl}${r.path}`, priority: r.priority, changeFrequency: r.changeFrequency })),
    ...PRODUCT_LINES.map((p) => ({ url: `${siteUrl}/insurance/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    ...ARTICLES.map((a) => ({ url: `${siteUrl}/learn/${a.slug}`, lastModified: a.updated ?? a.published, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...categories.map((c) => ({
      url: `${siteUrl}/explore/${c.slug}`,
      lastModified: c.updated_at,
      changeFrequency: "weekly" as const,
      priority: c.availability === "planned" ? 0.5 : 0.8,
    })),
  ];
}
