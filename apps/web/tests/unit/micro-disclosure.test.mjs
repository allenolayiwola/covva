import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Micro L2 instant purchase stores the same commission-on-sales disclosure as direct quotes
// (quotes.commission_disclosure is shown on quote detail, quotes list and apply pages). In-memory tables only.
const tables = {
  product_versions: [{ id: 'ver-m', product_id: 'prod-m', micro: true, status: 'approved', periods: ['day', 'week', 'month'], rating: { model: 'flat', amount: 365 }, issuance_type: 'instant', limits: {}, excesses: {}, coverage: [], exclusions: [], key_exclusion: null, waiting_period_days: 0, conditions: [] }],
  products: [{ id: 'prod-m', name: 'Fixture Micro', insurer_org_id: 'ins-m', category_id: 'cat-m', status: 'approved', current_version_id: 'ver-m' }],
  organizations: [{ id: 'ins-m', name: 'Fixture Insurance', integration_level: 'portal', status: 'active' }],
  product_categories: [{ id: 'cat-m', slug: 'personal-accident', name: 'Personal accident' }],
  insurer_line_integrations: [{ insurer_org_id: 'ins-m', category_id: 'cat-m', level: 'L2', active: true, issuance_type: 'instant' }],
  requests: [], order_routing: [], insurer_submissions: [], quotes: [], applications: [],
};
let seq = 0;
const svc = { from(table) {
  const filters = []; let op = 'select'; let values; let single = false;
  const q = {
    select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
    order() { return q; }, limit() { return q; },
    insert(v) { op = 'insert'; values = v; return q; }, upsert(v) { op = 'insert'; values = v; return q; },
    update(v) { op = 'update'; values = v; return q; },
    maybeSingle() { single = true; return q; }, single() { single = true; return q; },
    then(res, rej) {
      const rows = tables[table] ??= [];
      let out = op === 'insert' ? [] : rows.filter(r => filters.every(f => f(r)));
      if (op === 'insert') { const row = { id: `${table}-${++seq}`, reference: `REF-${seq}`, ...values }; rows.push(row); out = [row]; }
      if (op === 'update') out.forEach(r => Object.assign(r, values));
      return Promise.resolve({ data: structuredClone(single ? out[0] ?? null : out), error: null }).then(res, rej);
    },
  };
  return q;
} };
const noop = async () => {};
class BusinessRuleError extends Error {}
mock.module('../../src/lib/supabase/server.ts', { namedExports: { createServiceClient: () => svc } });
mock.module('../../src/server/plan-db.ts', { namedExports: { planDb: c => c } });
mock.module('../../src/server/requests.ts', { namedExports: { BusinessRuleError, createRequest: async () => { throw new Error('should be instant'); }, ruleMessage: (_e, f) => f } });
mock.module('../../src/server/notify.ts', { namedExports: { notify: noop, notifyOrg: noop } });
mock.module('../../src/server/log.ts', { namedExports: { log: { info() {}, warn() {}, error() {} } } });
mock.module('../../src/server/catalogue.ts', { namedExports: { quoteVersion: async () => ({ ok: false }) } });
mock.module('../../src/server/ledger.ts', { namedExports: { recordPaymentLedger: noop } });
mock.module('../../src/server/payment-methods.ts', { namedExports: { resolvePaymentMethod: noop } });
mock.module('../../src/server/payments.ts', { namedExports: { initiatePayment: async () => ({ paymentId: 'pay-1', status: 'pending' }), chargeStoredMethod: noop, initiatePolicyCollection: noop } });
mock.module('../../src/server/env.ts', { namedExports: { appUrl: () => 'https://example.test', simulatorEnabled: () => false } });

const { buyMicroCover } = await import('../../src/server/micro.ts');
const { DIRECT_QUOTE_DISCLOSURE } = await import('../../src/components/marketing/trust-copy.ts');

test('micro instant purchase stores the shared commission-on-sales disclosure on its quote', async () => {
  const result = await buyMicroCover('cust-1', 'ver-m', 'day', 'web', { momo: { phone: '0241234567', network: 'mtn' } });
  assert.equal(result.mode, 'instant');
  assert.equal(tables.quotes.length, 1);
  const quote = tables.quotes[0];
  assert.equal(quote.commission_disclosure, DIRECT_QUOTE_DISCLOSURE);
  assert.match(quote.commission_disclosure, /Covva receives a commission/);
  assert.doesNotMatch(quote.commission_disclosure, /platform fee/);
});
