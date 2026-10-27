"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Field, Input, Select, buttonClass, cn } from "@im/ui";
import { useT } from "@/lib/i18n/client";
import { CategoryIcon } from "./category-icon";

export interface QuoteCategory { slug: string; name: string; icon: string | null; availability: "integrated" | "broker_assisted" | "planned" }

/** Which extra fields the widget asks for per category. Plain GET form: works without JavaScript. */
const QUICK_FIELDS: Record<string, "motor" | "value" | "people" | "trip" | "none"> = {
  motor: "motor",
  home: "value",
  "sme-property": "value",
  health: "people",
  "life-funeral": "people",
  "personal-accident": "people",
  travel: "trip",
};

/**
 * Instant-quote widget (Addendum 5 hero). Choose a type, add a registration or a few details,
 * then "Get quotes" lands on /get-started?category=…&reg=… which routes into the quote flow.
 */
export function QuoteWidget({
  categories,
  defaultSlug,
  compact,
  className,
  title,
}: {
  categories: QuoteCategory[];
  defaultSlug?: string;
  compact?: boolean;
  className?: string;
  title?: string;
}) {
  const options = categories.filter((c) => c.availability !== "planned");
  const [slug, setSlug] = React.useState(defaultSlug && options.some((c) => c.slug === defaultSlug) ? defaultSlug : (options[0]?.slug ?? "motor"));
  const uid = React.useId();
  const t = useT();
  const id = (f: string) => `${uid}-${f}`;
  const kind = QUICK_FIELDS[slug] ?? "none";
  const current = options.find((c) => c.slug === slug);

  return (
    <form
      action="/get-started"
      method="get"
      aria-labelledby={id("title")}
      className={cn("rounded-[24px] border border-line bg-white p-5 shadow-float sm:p-6", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={id("title")} className="font-display text-[22px] leading-tight text-ink">{title ?? t("quoteWidget.title")}</h2>
        {current && <CategoryIcon icon={current.icon} className="size-6 text-brand" />}
      </div>
      <p className="mt-1 text-[13px] text-muted">{t("quoteWidget.subtitle")}</p>

      <div className={cn("mt-5 grid gap-4", compact ? "sm:grid-cols-2" : "")}>
        <Field label={t("quoteWidget.category")} htmlFor={id("category")} className={compact ? "sm:col-span-2" : undefined}>
          <Select id={id("category")} name="category" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {options.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </Field>

        {kind === "motor" && (
          <>
            <Field label={<>{t("quoteWidget.reg")} <span className="font-normal text-subtle">{t("common.optional")}</span></>} htmlFor={id("reg")} hint={t("quoteWidget.regHint")}>
              <Input id={id("reg")} name="reg" autoComplete="off" placeholder="GX 1234-24" maxLength={16} className="uppercase" />
            </Field>
            <Field label={<>{t("quoteWidget.vehicleValue")} <span className="font-normal text-subtle">{t("quoteWidget.ghsOptional")}</span></>} htmlFor={id("value")}>
              <Input id={id("value")} name="value" type="number" inputMode="numeric" min={1000} step={1000} placeholder="120000" />
            </Field>
          </>
        )}
        {kind === "value" && (
          <Field label={<>{t("quoteWidget.value")} <span className="font-normal text-subtle">{t("quoteWidget.ghsOptional")}</span></>} htmlFor={id("value")} hint={t("quoteWidget.valueHint")}>
            <Input id={id("value")} name="value" type="number" inputMode="numeric" min={1000} step={1000} placeholder="250000" />
          </Field>
        )}
        {kind === "people" && (
          <Field label={t("quoteWidget.people")} htmlFor={id("people")}>
            <Input id={id("people")} name="people" type="number" inputMode="numeric" min={1} max={50} defaultValue={1} />
          </Field>
        )}
        {kind === "trip" && (
          <Field label={t("quoteWidget.days")} htmlFor={id("days")}>
            <Input id={id("days")} name="days" type="number" inputMode="numeric" min={1} max={365} defaultValue={14} />
          </Field>
        )}
      </div>

      <button type="submit" className={buttonClass("primary", "lg", "mt-5 w-full")}>
        {t("quoteWidget.submit")} <ArrowRight aria-hidden className="size-4" />
      </button>
      <p className="mt-3 text-center text-[12px] leading-relaxed text-subtle">
        {t("quoteWidget.footnote")}
      </p>
    </form>
  );
}
