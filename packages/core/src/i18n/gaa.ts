import type { Catalogue } from "./types";

/**
 * Ga (`gaa`) catalogue.
 *
 * ONLY strings supplied by a human translator belong here — never machine translation.
 * Most translations are expected to arrive through the admin app (`translations` table,
 * draft → reviewed → approved); approved database rows override this file at runtime.
 * A key mapped to `null` means "translator has seen it and it must stay in English"
 * (e.g. brand names); missing keys simply fall back to English.
 *
 * Status: no translations supplied yet.
 */
export const gaa: Catalogue = {};
