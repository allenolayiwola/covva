import { ogCard } from "@/components/marketing/og-card";
import { pageCopy } from "@/lib/seo";

export const alt = pageCopy.partners.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard(pageCopy.partners.title, pageCopy.partners.description);
}
