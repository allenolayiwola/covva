import { notFound, permanentRedirect } from "next/navigation";
import { PRODUCT_LINES, findProductLine } from "@/components/marketing/products-content";

export function generateStaticParams() {
  return PRODUCT_LINES.map(({ slug }) => ({ slug }));
}

/** Legacy cover URLs share the product catalogue's canonical insurance URLs. */
export default async function CoverPage({ params }: PageProps<"/cover/[slug]">) {
  const { slug } = await params;
  if (!findProductLine(slug)) notFound();
  permanentRedirect(`/insurance/${slug}`);
}
