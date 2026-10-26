import type { MessageKey } from "./en";

/** A non-English catalogue: only the keys a translator has supplied (null = keep English). */
export type Catalogue = Partial<Record<MessageKey, string | null>>;

/** Flat key → string map as served to clients (`GET /api/v1/i18n/{locale}`). Unknown keys are ignored. */
export type Messages = Record<string, string>;

export interface TranslationRow {
  key: string;
  value: string | null;
  status?: string | null;
}
