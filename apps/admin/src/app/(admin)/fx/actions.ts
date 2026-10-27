"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Override = z.object({
  quote: z.enum(["GBP", "USD", "EUR", "CAD"]),
  rate: z.coerce.number().positive("Rate must be a positive number of GHS per 1 unit").max(10_000),
  note: z.string().trim().min(5, "Say where the rate came from (at least 5 characters)").max(500),
  validHours: z.coerce.number().int().min(1).max(24 * 14).default(24),
});

/**
 * Manual FX override (platform ops). Appends a `manual` row to `fx_rates` — rates are append-only
 * history, never edited — and is written to the audit log by trigger. Indicative display only: the
 * insurer is paid the GHS amount and the PSP applies its own rate.
 */
export async function setManualRate(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("operations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Override.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const now = new Date();
  const { error } = await auth.supabase.from("fx_rates").insert({
    base: "GHS",
    quote: d.quote,
    rate: d.rate,
    source: "manual",
    fetched_at: now.toISOString(),
    valid_until: new Date(now.getTime() + d.validHours * 3_600_000).toISOString(),
    created_by: auth.staff.userId,
    note: d.note,
  });
  if (error) return fail(dbMessage(error));
  return done(`Manual rate saved: 1 ${d.quote} = GH₵ ${d.rate}. The web app picks it up within a minute.`);
}

const Settings = z.object({
  marginPct: z.coerce.number().min(0).max(10),
  provider: z.enum(["manual", "openexchangerates", "bog"]),
});

/** FX display settings (`platform_settings.fx`): margin shown to payers and the rate provider for the hourly cron. */
export async function setFxSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("platform");
  if (!auth.ok) return fail(auth.error);
  const parsed = Settings.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("platform_settings").upsert(
    { key: "fx", value: { margin_pct: parsed.data.marginPct, provider: parsed.data.provider }, description: "FX display: platform margin % added to the indicative rate (shown to the payer) and the rate provider.", updated_by: auth.staff.userId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return fail(dbMessage(error));
  return done(`FX settings saved: margin ${parsed.data.marginPct}% · provider ${parsed.data.provider}.`);
}
