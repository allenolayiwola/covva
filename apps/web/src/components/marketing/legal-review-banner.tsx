import { Notice } from "@im/ui";
import { getFlags } from "@/lib/catalog";

export async function LegalReviewBanner() {
  const flags = await getFlags().catch(() => ({} as Record<string, boolean>));
  if (flags.legal_review_banner === false) return null;
  return <Notice tone="wait" className="mb-6">This document is under legal review.</Notice>;
}
