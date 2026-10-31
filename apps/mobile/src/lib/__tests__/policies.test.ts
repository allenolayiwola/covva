import { policyStatus, renewalDueDays } from '../policies';
import { hasRail } from '../layout';

it.each([
  ['pending_issuance', 'Pending'], ['active', 'Active'], ['lapsed', 'Lapsed'],
  ['cancelled', 'Cancelled'], ['expired', 'Expired'], ['renewed', 'Renewed'],
] as const)('maps %s to the shared customer label', (status, label) => {
  expect(policyStatus({ status, external_source: false }).label).toBe(label);
});
it('does not label externally added cover as confirmed active', () => {
  expect(policyStatus({ status: 'active', external_source: true }).label).toBe('Added by you');
});
const now = new Date('2026-10-31T00:00:00Z');
it.each([[0, 0], [1, 1], [60, 60], [61, null], [-1, null]])('highlights only the 60-day renewal window: %s', (days, expected) => {
  const cover_end = new Date(now.getTime() + days! * 86400000).toISOString();
  expect(renewalDueDays({ status: 'active', cover_end }, now)).toBe(expected);
});
it.each(['pending_issuance', 'lapsed', 'cancelled', 'expired', 'renewed'] as const)('does not highlight %s for renewal', status => {
  expect(renewalDueDays({ status, cover_end: '2026-11-01' }, now)).toBeNull();
});
it.each([null, 'invalid', '2026-10-30T23:59:59Z'])('ignores missing, invalid and past dates: %s', cover_end => {
  expect(renewalDueDays({ status: 'active', cover_end }, now)).toBeNull();
});
it.each([[390, false], [600, false], [839, false], [840, true], [1200, true]] as const)('uses rail and list-detail at window width %s', (width, expected) => {
  expect(hasRail(width)).toBe(expected);
});

it('keeps date-only renewals due today visible after midnight', () => {
  expect(renewalDueDays({ status: 'active', cover_end: '2026-10-31' }, new Date('2026-10-31T15:30:00Z'))).toBe(0);
});
