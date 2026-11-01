import * as React from "react";
import { Container, Eyebrow, cn } from "@im/ui";

/**
 * A full-width page band with the shared 1440px container and the 8pt rhythm (96px between sections on
 * desktop, 64px on phones). Light theme only: the former dark "ink" and "brand" tones now render as light
 * mist / mint bands, so `invert` is accepted for compatibility but no longer changes colours.
 */
export function Section({
  id,
  tone = "white",
  className,
  containerClassName,
  labelledBy,
  children,
}: {
  id?: string;
  tone?: "white" | "mist" | "ink" | "brand";
  className?: string;
  containerClassName?: string;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "relative scroll-mt-20 py-16 lg:py-24",
        tone === "mist" && "bg-mist",
        tone === "ink" && "bg-mist",
        tone === "brand" && "bg-mint/60",
        className,
      )}
    >
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  align = "left",
  as: As = "h2",
  className,
  invert,
}: {
  id?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  className?: string;
  invert?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-10 flex flex-col gap-5 sm:mb-12",
        align === "center" ? "items-center text-center" : "md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <As id={id} className={cn("text-balance text-ink", As === "h1" ? "text-h1" : As === "h2" ? "text-h2" : "text-h3", invert && undefined)}>
          {title}
        </As>
        {description && <p className="mt-4 text-lead text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Small round icon tile used across feature grids. */
export function IconTile({ children, tone = "mint", size = "md", className }: { children: React.ReactNode; tone?: "mint" | "white" | "brand" | "amber"; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center",
        size === "md" ? "size-11 rounded-xl [&>svg]:size-5" : "size-9 rounded-[10px] [&>svg]:size-4",
        tone === "mint" && "bg-mint text-brand-deep",
        tone === "white" && "bg-white text-brand shadow-card ring-1 ring-line",
        tone === "brand" && "bg-brand text-white",
        tone === "amber" && "bg-amber-bg text-amber",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Feature card: icon, title, body. */
export function FeatureCard({
  icon,
  title,
  children,
  className,
  iconTone,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  iconTone?: "mint" | "white" | "brand" | "amber";
}) {
  return (
    <div className={cn("rounded-card border border-line bg-white p-6", className)}>
      <IconTile tone={iconTone}>{icon}</IconTile>
      <h3 className="mt-5 text-[20px] leading-[1.25] md:text-[24px] text-ink">{title}</h3>
      <div className="mt-2 text-[15px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** Ticked list used for safeguards, rules and promises. */
export function CheckList({ items, className, invert }: { items: React.ReactNode[]; className?: string; invert?: boolean }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((it, i) => (
        <li key={i} className={cn("flex gap-3 text-[15px] leading-relaxed text-ink-2", invert && undefined)}>
          <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint text-brand-deep">
            <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}
