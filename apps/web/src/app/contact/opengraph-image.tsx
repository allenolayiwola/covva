import { ogCard } from "@/components/marketing/og-card";
import { pageCopy } from "@/lib/seo";

export const alt = pageCopy.contact.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard(pageCopy.contact.title, pageCopy.contact.description);
}
