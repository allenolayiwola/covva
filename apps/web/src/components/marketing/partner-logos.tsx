import Image from "next/image";
import { cn } from "@im/ui";
import type { PartnerView } from "@/server/cms";
import { OrgTile } from "./org-tile";

/**
 * CMS partner logos (home trust bar, page "partner strip" block). A partner without a logo gets the
 * monogram tile plus its name as real text, so nothing depends on an image loading. Logos are
 * constrained to 32px high; the name stays visible for screen readers through the alt text.
 */
export function PartnerLogos({ partners, className, size = 30 }: { partners: PartnerView[]; className?: string; size?: number }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-6 gap-y-3", className)} aria-label="Participating partners">
      {partners.map((p) => {
        const inner = p.logo ? (
          <Image
            src={p.logo.url}
            alt={p.logo.alt || p.name}
            width={p.logo.width ?? 120}
            height={p.logo.height ?? 32}
            className="h-8 w-auto max-w-[140px] object-contain"
            sizes="140px"
          />
        ) : (
          <>
            <OrgTile name={p.name} color={p.brandColor} size={size} />
            <span className="text-[15px] font-medium text-ink-2">{p.name}</span>
          </>
        );
        const title = p.licenceNumber ? `${p.name} · NIC licence ${p.licenceNumber}` : p.name;
        return (
          <li key={p.slug} className="flex items-center gap-2.5" title={title}>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {inner}
                <span className="sr-only">{p.name} (opens in a new tab)</span>
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
