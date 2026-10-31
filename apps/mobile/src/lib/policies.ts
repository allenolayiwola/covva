import { daysUntil, POLICY_STATUS } from '@im/core';
import type { Row } from '@im/db';

export type Policy = Pick<Row<'policies'>, 'id' | 'status' | 'nickname' | 'policy_number' | 'internal_reference' | 'cover_start' | 'cover_end' | 'premium' | 'billing_period' | 'external_source'> & {
  category: { name: string } | null;
  insurer: { name: string } | null;
  external_insurer_name?: string | null;
  statusHint?: string | null;
  coverActive: boolean;
  demo: boolean;
};
export type PolicyDetail = { policy: Policy; disclosure: string | null };
export type PolicyDocuments = { documents: { id: string; fileName: string; url: string | null }[] };
export function policyStatus(policy: Pick<Policy, 'status' | 'external_source'>) {
  if (policy.external_source && policy.status === 'active') return { label: 'Added by you', tone: 'neutral' as const };
  return POLICY_STATUS[policy.status];
}
/** Same 60-day window as the web wallet; past dates and inactive policies are excluded. */
export function renewalDueDays(policy: Pick<Policy, 'status' | 'cover_end'>, now = new Date()): number | null {
  if (policy.status !== 'active' || !policy.cover_end) return null;
  // API cover dates are calendar dates: keep today's renewal visible throughout the day.
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(policy.cover_end)
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) : now;
  if (Date.parse(policy.cover_end) < reference.getTime()) return null;
  const days = daysUntil(policy.cover_end, reference);
  return days !== null && Number.isFinite(days) && days >= 0 && days <= 60 ? days : null;
}
export function policyTitle(policy: Policy) {
  return policy.nickname || policy.category?.name || 'Policy';
}
