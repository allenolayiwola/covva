import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Direct instant quote → declarations step → created application, end to end through the real server code
// (server/direct-quotes.ts instantDirectQuote and the apply page's submitApplication action). Only the database
// (in-memory tables), pricing/underwriting and notification boundaries are mocked; nothing touches a live project.
const REQUEST = '11111111-1111-4111-8111-111111111111';
const INSURER = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const tables = {
  requests: [{ id: REQUEST, reference: 'REQ-direct', status: 'routed', customer_id: CUSTOMER, broker_org_id: null, routing_mode: 'insurer_direct', category_id: 'cat-motor', risk_data: { use: 'private' }, category: { slug: 'motor' }, broker: null }],
  insurer_line_integrations: [{ insurer_org_id: INSURER, category_id: 'cat-motor', level: 'L2', direct_sales: true, active: true, issuance_type: 'instant', insurer: { id: INSURER, name: 'Fixture Insurance', status: 'active' } }],
  products: [{ id: 'prod-1', name: 'Fixture Motor', insurer_org_id: INSURER, category_id: 'cat-motor', status: 'approved', version: { id: 'ver-1', status: 'approved', micro: false, issuance_type: 'instant', rating: {}, excesses: {}, key_exclusion: 'Racing', optional_benefits: [] } }],
  insurer_submissions: [{ id: 'sub-1', request_id: REQUEST, insurer_org_id: INSURER, status: 'sent' }],
  quotes: [], applications: [], broker_disclosures: [],
};
let sequence = 0;
const uuidFor = () => `44444444-4444-4444-8444-${String(++sequence).padStart(12, '0')}`;
const pick = (row, cols) => {
  if (!cols || cols.trim() === '*' ) return row;
  const out = {};
  for (const raw of cols.split(/,(?![^(]*\))/)) {
    const c = raw.trim(); const alias = c.includes(':') ? c.split(':')[0] : c.split('(')[0];
    if (alias in row) out[alias] = row[alias];
  }
  return out;
};
const svc = { from(table) {
  const filters = []; let operation = 'select'; let values; let single = false; let cols = '*';
  const query = {
    select(c) { if (operation === 'select' || c) cols = c ?? '*'; return query; },
    eq(k, v) { filters.push(row => row[k] === v); return query; },
    in(k, v) { filters.push(row => v.includes(row[k])); return query; },
    order() { return query; }, limit() { return query; },
    update(v) { operation = 'update'; values = v; return query; },
    insert(v) { operation = 'insert'; values = v; return query; },
    maybeSingle() { single = true; return query; }, single() { single = true; return query; },
    then(resolve, reject) {
      const rows = tables[table] ??= [];
      let result = operation === 'insert' ? [] : rows.filter(row => filters.every(f => f(row)));
      if (operation === 'insert') { const row = { id: uuidFor(), ...values }; rows.push(row); result = [row]; }
      if (operation === 'update') result.forEach(row => Object.assign(row, values));
      const data = result.map(r => pick(r, operation === 'select' ? cols : 'id'));
      return Promise.resolve({ data: structuredClone(single ? data[0] ?? null : data), error: null }).then(resolve, reject);
    },
  };
  return query;
} };
const user = { id: CUSTOMER };
const noop = async () => {};
const notified = [];
class BusinessRuleError extends Error {}
mock.module('../../src/lib/supabase/server.ts', { namedExports: { createServiceClient: () => svc, createClient: async () => ({ ...svc, auth: { getUser: async () => ({ data: { user } }) } }) } });
mock.module('../../src/server/catalogue.ts', { namedExports: {
  quoteVersion: async () => ({ ok: true, premium: 1850, sumInsured: 150000, lines: [], appliedLoadings: [] }),
  evaluateUnderwriting: async () => ({ outcome: 'accept', matched: [], reasons: [] }),
  issuanceSummary: () => ({ type: 'instant', label: 'Instant cover' }),
} });
mock.module('../../src/server/loyalty.ts', { namedExports: { applyLoyaltyToQuote: noop } });
mock.module('../../src/server/log.ts', { namedExports: { log: { info() {}, warn() {}, error() {} } } });
mock.module('../../src/server/requests.ts', { namedExports: { BusinessRuleError, ruleMessage: (_e, f) => f } });
mock.module('../../src/server/notify.ts', { namedExports: { notify: noop, notifyOrg: async (...a) => { notified.push(a); } } });
mock.module('../../src/server/webhooks.ts', { namedExports: { emitEvent: async (...a) => { notified.push(a); } } });
mock.module('../../src/server/payments.ts', { namedExports: { initiatePayment: noop } });
mock.module('../../src/server/instalments.ts', { namedExports: { createScheduleForApplication: noop } });
mock.module('../../src/lib/catalog.ts', { namedExports: { getSetting: async () => 'terms-fixture-v1' } });
mock.module('next/headers.js', { namedExports: { headers: async () => new Headers() } });
mock.module('next/navigation.js', { namedExports: { redirect: () => { throw new Error('unexpected redirect'); } } });
mock.module('next/cache.js', { namedExports: { refresh: () => {}, revalidatePath: () => {} } });

const { instantDirectQuote, DIRECT_QUOTE_DISCLOSURE } = await import('../../src/server/direct-quotes.ts');
const trust = await import('../../src/components/marketing/trust-copy.ts');
const { submitApplication } = await import('../../src/app/(site)/(customer)/account/requests/[id]/apply/[quoteId]/actions.ts');
const { declarationsFor } = await import('../../src/app/(site)/(customer)/account/requests/[id]/apply/[quoteId]/declarations.ts');

test('P2a: the direct-quote disclosure uses the commission-on-sales wording shared with the trust statement', () => {
  assert.equal(trust.DIRECT_QUOTE_DISCLOSURE, DIRECT_QUOTE_DISCLOSURE, 'direct offers and stored quotes share one disclosure');
  assert.ok(DIRECT_QUOTE_DISCLOSURE.startsWith('Sold directly by the insurer.'));
  assert.ok(DIRECT_QUOTE_DISCLOSURE.includes(trust.TRUST_STATEMENT));
  assert.match(DIRECT_QUOTE_DISCLOSURE, /Covva receives a commission/);
  assert.doesNotMatch(DIRECT_QUOTE_DISCLOSURE, /platform fee|%|\d/);
});

test('P2b: instant direct quote → declarations → one submitted application, with no broker step', async () => {
  const request = tables.requests[0];
  const made = await instantDirectQuote(svc, request, INSURER);
  assert.ok(made, 'an instant binding quote is created');
  const quote = tables.quotes.find(q => q.id === made.quoteId);
  assert.equal(quote.status, 'ready_to_accept');
  assert.equal(quote.broker_org_id, null);
  assert.equal(quote.commission_disclosure, DIRECT_QUOTE_DISCLOSURE);
  assert.match(quote.commission_disclosure, /Covva receives a commission/);
  assert.equal(tables.insurer_submissions[0].status, 'quoted');
  quote.insurer = { name: 'Fixture Insurance' };

  const decls = declarationsFor('motor', { insurer: 'Fixture Insurance', keyExclusion: quote.key_exclusion, risk: request.risk_data });
  const form = (omit) => {
    const fd = new FormData();
    fd.set('requestId', REQUEST); fd.set('quoteId', quote.id);
    for (const d of decls) if (d.key !== omit) fd.set(`decl_${d.key}`, 'on');
    fd.set('accept_terms', 'on');
    return fd;
  };

  const missing = await submitApplication({ ok: false }, form(decls[0].key));
  assert.equal(missing.ok, false);
  assert.ok(missing.fieldErrors[`decl_${decls[0].key}`]);
  assert.equal(tables.applications.length, 0, 'no application until every declaration is confirmed');

  const ok = await submitApplication({ ok: false }, form());
  assert.deepEqual(ok, { ok: true });
  const again = await submitApplication({ ok: false }, form());
  assert.deepEqual(again, { ok: true });
  assert.equal(tables.applications.length, 1, 'idempotent: one application per quote');
  const app = tables.applications[0];
  assert.equal(app.status, 'submitted');
  assert.equal(app.quote_id, quote.id);
  assert.equal(app.request_id, REQUEST);
  assert.equal(app.customer_id, CUSTOMER);
  assert.equal(app.disclosure_id, null, 'direct purchase has no broker disclosure');
  assert.equal(app.terms_version, 'terms-fixture-v1');
  for (const d of decls) assert.equal(app.declarations[d.key], true);
  assert.equal(notified.length, 0, 'no broker is notified on a direct purchase');
});
