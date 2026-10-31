import { normaliseRegistration, prefillFromLookup, quickQuoteFields, type RiskField } from '@im/core';
import { canApply, comparisonCopy, fieldErrors, validateRisk } from '../model';
import { isListDetail } from '../../../lib/layout';

const fields: RiskField[] = [
  { key: 'registration_number', label: 'Registration', type: 'text', required: true },
  { key: 'use', label: 'Use', type: 'select', required: true, options: [{ value: 'private', label: 'Private' }] },
  { key: 'vehicle_value', label: 'Value', type: 'currency', required: true, min: 1000 },
  { key: 'vehicle_year', label: 'Year', type: 'number', required: true, min: 1990, max: 2030 },
  { key: 'region', label: 'Region', type: 'region', required: true },
  { key: 'date', label: 'Start date', type: 'date', required: true },
  { key: 'extras', label: 'Extras', type: 'multiselect' },
  { key: 'claims', label: 'Claims', type: 'boolean', required: true },
  { key: 'optional_number', label: 'Optional', type: 'number' },
];
const valid = { registration_number: 'GR 1234-23', use: 'private', vehicle_value: '50000', vehicle_year: '2020', region: 'Greater Accra', date: '2026-12-01', claims: 'false' };
it('coerces the form into a request payload using the shared schema', () => {
  const result = validateRisk(fields, valid);
  expect(result.errors).toEqual({});
  expect(result.risk).toMatchObject({ vehicle_value: 50000, vehicle_year: 2020, claims: false, extras: [] });
  expect(result.risk?.optional_number).toBeUndefined();
});
it('maps required, range, enum and date validation errors to fields', () => {
  const result = validateRisk(fields, { ...valid, registration_number: '', vehicle_value: '999', vehicle_year: 'abc', use: 'invalid', region: 'invalid', date: 'tomorrow' });
  expect(Object.keys(result.errors).sort()).toEqual(['date', 'region', 'registration_number', 'use', 'vehicle_value', 'vehicle_year']);
  expect(result.errors.vehicle_value).toBe('Value must be at least 1000');
});
it('does not turn blank required numbers into zero or unanswered booleans into no', () => {
  expect(validateRisk([{ key: 'n', label: 'Number', type: 'number', required: true }], { n: ' ' }).errors.n).toBeDefined();
  expect(validateRisk(fields, { ...valid, claims: '' }).errors.claims).toBe('Claims is required');
});
it('maps REST array and dotted risk paths and ignores malformed details', () => {
  expect(fieldErrors([{ path: ['risk', 'use'], message: 'Choose a use' }, { path: 'risk.vehicle_value', message: 'Too low' }, { path: ['use'], message: 'Second error' }, null])).toEqual({ use: 'Choose a use', vehicle_value: 'Too low' });
  expect(fieldErrors({ message: 'Not field errors' })).toEqual({});
});
it('uses a three-field motor start and fills only missing lookup values', () => {
  expect(quickQuoteFields(fields).quick.map(f => f.key)).toEqual(['registration_number', 'use', 'vehicle_value']);
  expect(normaliseRegistration('gr123423')).toBe('GR 1234-23');
  expect(prefillFromLookup({ vehicle_make: 'Edited', use: 'private' }, { make: 'Toyota', model: 'Camry', year: 2020, use: 'commercial' })).toEqual({ vehicle_make: 'Edited', vehicle_model: 'Camry', vehicle_year: '2020', use: 'private' });
});
const now = Date.parse('2026-10-31T12:00:00Z');
it.each(['estimate', 'awaiting_underwriting', 'accepted', 'expired', 'declined', 'withdrawn'] as const)('never offers Apply for %s', status => {
  expect(canApply({ status, valid_until: '2026-11-01T00:00:00Z', expired: false }, now)).toBe(false);
});
it('accepts only ready quotes before expiry and fails closed for malformed dates', () => {
  const ready = { status: 'ready_to_accept' as const, expired: false };
  expect(canApply({ ...ready, valid_until: '2026-11-01T00:00:00Z' }, now)).toBe(true);
  expect(canApply({ ...ready, valid_until: new Date(now).toISOString() }, now)).toBe(false);
  expect(canApply({ ...ready, valid_until: '2026-10-30T00:00:00Z' }, now)).toBe(false);
  expect(canApply({ ...ready, valid_until: 'bad' }, now)).toBe(false);
  expect(canApply({ ...ready, valid_until: null }, now)).toBe(true);
  expect(canApply({ ...ready, valid_until: null, expired: true }, now)).toBe(false);
});
it('uses the comparison insurer count honestly, including zero and singular', () => {
  expect(comparisonCopy(0)).toBe('No insurers compared yet.');
  expect(comparisonCopy(1)).toBe('1 insurer compared — we show every licensed insurer that quoted for this risk');
  expect(comparisonCopy(3)).toBe('3 insurers compared — we show every licensed insurer that quoted for this risk');
});
it.each([[375, false], [600, false], [839, false], [840, true], [951, true], [1024, true]])('uses list-detail at width %s: %s', (width, expected) => {
  expect(isListDetail(width as number)).toBe(expected);
});
