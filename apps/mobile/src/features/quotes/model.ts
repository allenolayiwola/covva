import { riskSchemaToZod, type RiskField, type ComparisonResult, type ComparableQuote } from '@im/core';

export type FormValues = Record<string, string | string[]>;
export type Category = {
  id: string; slug: string; name: string; description: string | null;
  availability: 'integrated' | 'broker_assisted' | 'planned'; risk_schema: RiskField[];
};
export type CategoryDetail = { category: Category; productsCount: number; insurersCount: number; demoMode: boolean };
export type Quote = {
  id: string; status: ComparableQuote['status']; statusLabel: string; statusHint: string | null;
  premium: number; excess: number | null; sum_insured: number | null; valid_until: string | null;
  expired: boolean; paid_placement: boolean; demo: boolean;
  insurer: { name: string } | null; product: { name: string } | null;
  coverage: ComparableQuote['coverage']; exclusions: string[]; key_exclusion: string | null;
  waiting_period_days: number; optional_benefits: ComparableQuote['optionalBenefits'];
};
export type QuotesResponse = {
  request: { id: string; reference: string };
  broker: { name: string; nic_licence_number: string | null } | null;
  quotes: Quote[]; comparison: ComparisonResult; summary: string; disclosure: string | null;
  comparedAt: string; demoMode: boolean; demoDisclaimer: string | null;
};

/** Both Zod issues and REST invalid_input details use paths; server risk paths have a prefix. */
export function fieldErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const errors: Record<string, string> = {};
  for (const issue of details) {
    if (!issue || typeof issue.message !== 'string') continue;
    const path = Array.isArray(issue.path) ? issue.path : typeof issue.path === 'string' ? issue.path.split('.') : [];
    const key = path[0] === 'risk' ? path[1] : path[0];
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function validateRisk(fields: RiskField[], values: FormValues) {
  // Avoid Number('') silently satisfying a required numeric field with zero.
  const input = Object.fromEntries(fields.map(f => [f.key,
    (f.type === 'number' || f.type === 'currency') && !String(values[f.key] ?? '').trim()
      ? undefined : values[f.key] ?? (f.type === 'multiselect' ? [] : ''),
  ]));
  const parsed = riskSchemaToZod(fields).safeParse(input);
  const errors = parsed.success ? {} : fieldErrors(parsed.error.issues);
  for (const f of fields) {
    const value = values[f.key];
    if (f.required && (value === undefined || value === '' || (Array.isArray(value) && !value.length))) {
      errors[f.key] = `${f.label} is required`;
    }
  }
  return { risk: parsed.success ? parsed.data : null, errors };
}

export function canApply(quote: Pick<Quote, 'status' | 'valid_until' | 'expired'>, now = Date.now()) {
  return quote.status === 'ready_to_accept' && !quote.expired &&
    (quote.valid_until === null || Date.parse(quote.valid_until) > now);
}
export function comparisonCopy(insurersCompared: number) {
  if (insurersCompared === 0) return 'No insurers compared yet.';
  return `${insurersCompared} insurer${insurersCompared === 1 ? '' : 's'} compared — we show every licensed insurer that quoted for this risk`;
}
