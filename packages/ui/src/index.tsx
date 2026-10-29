import * as React from "react";
import clsx from "clsx";
import type { Tone } from "@im/core";

export { clsx as cn };

export { BRAND, CanopyMark, LogoMark, Logo, type LogoProps, type CanopyMarkProps } from "./brand";

/* ----------------------------------------------------------------------------
 * Buttons
 * ------------------------------------------------------------------------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "white";
type ButtonSize = "sm" | "md" | "lg";

/**
 * Every button is a full pill on the public site (desktop redesign): `rounded-button` defaults to a full pill in
 * @im/tokens and an app may override `--radius-button` (the admin uses near-square corners). Heights sit on the
 * 8pt grid; the smallest is a 40px tap target.
 */
const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-button font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "bg-mint text-brand-deep hover:bg-[#cfe7da]",
  ghost: "text-ink-2 hover:bg-mist",
  outline: "border border-line bg-white text-ink hover:bg-mist",
  danger: "bg-danger text-white hover:bg-[#912018]",
  white: "bg-white text-brand-deep hover:bg-mist",
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-[15px]",
  lg: "h-14 px-7 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* ----------------------------------------------------------------------------
 * Pills & badges
 * ------------------------------------------------------------------------- */
const toneClass: Record<Tone, string> = {
  ok: "bg-mint text-brand-dark",
  wait: "bg-amber-bg text-amber",
  neutral: "bg-[#EEF2F1] text-muted",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function StatusPill({ meta, className }: { meta: { label: string; tone: Tone }; className?: string }) {
  return <Pill tone={meta.tone} className={className}>{meta.label}</Pill>;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={clsx("text-xs font-semibold uppercase tracking-[0.12em] text-brand", className)}>{children}</p>;
}

/* ----------------------------------------------------------------------------
 * Surfaces
 * ------------------------------------------------------------------------- */
export function Card({ className, children, as: As = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return (
    <As className={clsx("rounded-card border border-line bg-white", className)} {...props}>
      {children}
    </As>
  );
}

export function HeroCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-card bg-brand-dark p-6 text-white", className)}>
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/8" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function StatCard({ label, value, tone, hint, className }: { label: string; value: React.ReactNode; tone?: "default" | "warn"; hint?: React.ReactNode; className?: string }) {
  return (
    <Card className={clsx("p-5", className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx("mt-2 text-3xl font-bold tracking-tight", tone === "warn" ? "text-amber" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

export function Avatar({ name, initials, size = 40, className }: { name?: string; initials?: string; size?: number; className?: string }) {
  const text = initials ?? (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <span
      className={clsx("inline-grid shrink-0 place-items-center rounded-full bg-mint font-semibold text-brand-deep", className)}
      style={{ width: size, height: size, fontSize: Math.max(13, Math.round(size * 0.36)) }}
      aria-label={name}
    >
      {text}
    </span>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center rounded-card border border-dashed border-line bg-mist/50 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-full bg-mint text-brand">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {body && <div className="mt-1 max-w-md text-sm text-muted">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        {eyebrow && <p className="mb-1 text-sm text-muted">{eyebrow}</p>}
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Notices required by the spec
 * ------------------------------------------------------------------------- */
export function DemoBadge({ className, text = "Illustrative only. Insurers shown are not partners. · Demo data" }: { className?: string; text?: string }) {
  return <span className={clsx("inline-block rounded-md bg-[#EEF2F1] px-2.5 py-1 text-xs text-muted", className)}>{text}</span>;
}

export function Notice({ tone = "info", title, children, icon, className }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={clsx("flex gap-3 rounded-xl p-4 text-sm", toneClass[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

/** Mandatory "who does what" disclosure shown before advice/application and on every policy. */
export function DisclosureBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("rounded-xl border border-line bg-mist px-4 py-3 text-[13px] leading-relaxed text-ink-2", className)}>
      <span className="font-semibold text-ink">Who does what. </span>
      {text}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Forms
 * ------------------------------------------------------------------------- */
const fieldBase =
  "block w-full rounded-field border border-line bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-mist aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx(fieldBase, "h-11", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={clsx(fieldBase, "min-h-28", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={clsx(fieldBase, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23486068%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_0.9rem_center] bg-no-repeat pr-9", className)} {...props}>
      {children}
    </select>
  );
});

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={clsx("mb-1.5 block text-sm font-medium text-ink-2", className)} {...props}>{children}</label>;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : hint ? <p className="mt-1.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-3 text-sm text-ink-2", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-line accent-brand" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* ----------------------------------------------------------------------------
 * Tables & lists
 * ------------------------------------------------------------------------- */
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("overflow-x-auto rounded-card border border-line bg-white", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-mist text-xs font-semibold uppercase tracking-wider text-muted">{children}</thead>;
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={clsx("px-4 py-3 font-semibold", className)}>{children}</th>;
}
export function Td({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx("border-t border-line px-4 py-3.5 align-middle text-ink-2", className)} {...props}>{children}</td>;
}

export function DefinitionList({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx("divide-y divide-line", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 text-sm">
          <dt className="text-muted">{it.label}</dt>
          <dd className="text-right font-medium text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------------------
 * Progress / timeline (request tracker from the mockups)
 * ------------------------------------------------------------------------- */
export interface TimelineStep { title: React.ReactNode; detail?: React.ReactNode; state: "done" | "current" | "upcoming"; action?: React.ReactNode }

export function Timeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={clsx("relative", className)}>
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-3 pb-6 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden className={clsx("absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5", s.state === "done" ? "bg-brand" : "bg-line")} />
          )}
          <span
            aria-hidden
            className={clsx(
              "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
              s.state === "done" && "border-brand bg-brand text-white",
              s.state === "current" && "border-gold bg-amber-bg",
              s.state === "upcoming" && "border-line bg-white",
            )}
          >
            {s.state === "done" && (
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>
            )}
            {s.state === "current" && <span className="size-2 rounded-full bg-gold" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={clsx("text-sm font-semibold", s.state === "upcoming" ? "text-subtle" : "text-ink")}>{s.title}</p>
            {s.detail && <div className="mt-0.5 text-xs text-muted">{s.detail}</div>}
            {s.action && <div className="mt-2.5">{s.action}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Checkpoints({ labels, done, className }: { labels: string[]; done: boolean[]; className?: string }) {
  return (
    <ol className={clsx("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}>
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={clsx(done[i] ? "font-medium text-brand" : "text-muted")}>{done[i] ? "✓ " : ""}{l}</span>
          {i < labels.length - 1 && <span aria-hidden className="text-subtle">→</span>}
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------------------------
 * Layout helpers
 * ------------------------------------------------------------------------- */
/** Shared 1440px site container: 20px side padding on phones, 32px from 768, 64px from 1280, 80px from 1440. */
export const containerClass = "mx-auto w-full max-w-site px-5 md:px-8 xl:px-16 wide:px-20";

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx(containerClass, className)}>{children}</div>;
}

export function Tabs({ items, active, className }: { items: { key: string; label: React.ReactNode; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <nav className={clsx("flex gap-1 overflow-x-auto rounded-xl bg-mist p-1", className)} aria-label="Tabs">
      {items.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={clsx(
            "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
            t.key === active ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-subtle">{t.count}</span>}
        </a>
      ))}
    </nav>
  );
}
