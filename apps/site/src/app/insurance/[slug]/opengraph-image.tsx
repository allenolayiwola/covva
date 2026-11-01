import { notFound } from "next/navigation";
import { ogCard } from "@/components/marketing/og-card";
import { findProductLine, PRODUCT_LINES } from "@/components/marketing/products-content";

export const alt = "Insurance in Ghana through licensed partners — Covva";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export function generateStaticParams() { return PRODUCT_LINES.map(({ slug }) => ({ slug })); }

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const line = findProductLine((await params).slug);
  if (!line) notFound();
  return ogCard(`${line.name} in Ghana`, line.lede);
}
