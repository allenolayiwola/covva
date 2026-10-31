import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { canTransitionPartnerInvoice } from '../../../../packages/core/src/partner-billing.ts';

const require = createRequire(import.meta.url);
function load(path, mocks) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { exports, require: id => id in mocks ? mocks[id] : require(id) });
  return exports;
}
function harness({ authorized = true, enabled = true, status = 'draft', changed = true } = {}) {
  const calls = [];
  let mutation = false;
  const query = {
    select(...args) { calls.push(['select', ...args]); return query; },
    eq(...args) { calls.push(['eq', ...args]); return query; },
    update(patch) { mutation = true; calls.push(['update', patch]); return query; },
    async single() { return { data: { status, lines: [] } }; },
    async maybeSingle() { return { data: mutation && changed ? { id: 'invoice' } : null, error: null }; },
  };
  const supabase = { from(table) { calls.push(['from', table]); return query; } };
  const actions = {
    async authorize(permission) { calls.push(['authorize', permission]); return authorized ? { ok: true, supabase } : { ok: false, error: 'denied' }; },
    fail: error => ({ ok: false, error }), done: message => ({ ok: true, message }),
    formObject: fd => Object.fromEntries(fd), zodError: () => ({ ok: false, error: 'invalid' }), dbMessage: e => e.message,
  };
  const mocks = {
    '@/lib/actions': actions,
    '@/lib/partner-billing': { async partnerBillingEnabled() { calls.push(['flag']); return enabled; } },
    '@im/core': { canTransitionPartnerInvoice },
    'next/navigation': { redirect() { throw new Error('unexpected redirect'); } },
    '@/lib/billing': {},
    '@/lib/revalidate': {},
  };
  return { calls, invoice: load('../../src/app/(admin)/invoices/actions.ts', mocks),
    subscription: load('../../src/app/(admin)/subscriptions/actions.ts', mocks),
    plans: load('../../src/app/(admin)/plans/actions.ts', mocks) };
}
function transitionForm(to) {
  const fd = new FormData();
  fd.set('invoiceId', 'e2000000-0000-4000-8000-000000000001');
  fd.set('to', to); fd.set('reason', 'Agreed correction');
  return fd;
}
for (const authorized of [false, true]) {
  test(`all billing mutations fail closed (authorized=${authorized}, flag off)`, async () => {
    const h = harness({ authorized, enabled: false });
    for (const action of [h.invoice.generateInvoice, h.invoice.transitionInvoice, h.subscription.saveSubscription, h.plans.savePlan]) {
      assert.equal((await action({}, new FormData())).ok, false);
    }
    assert.equal(h.calls.filter(c => c[0] === 'from').length, 0);
    assert.equal(h.calls.filter(c => c[0] === 'authorize').length, 4);
  });
}
for (const status of ['paid', 'void']) {
  test(`${status} invoice refuses mutations before database update`, async () => {
    const h = harness({ status });
    assert.equal((await h.invoice.transitionInvoice({}, transitionForm('issued'))).ok, false);
    assert.equal(h.calls.filter(c => c[0] === 'update').length, 0);
  });
}
test('invoice update compares original status and rejects concurrent changes', async () => {
  const h = harness({ changed: false });
  const result = await h.invoice.transitionInvoice({}, transitionForm('paid'));
  assert.equal(result.ok, false);
  assert.match(result.error, /changed/);
  assert.ok(h.calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'draft'));
});
test('draft can be marked paid and stamps the payment date', async () => {
  const h = harness();
  assert.equal((await h.invoice.transitionInvoice({}, transitionForm('paid'))).ok, true);
  assert.equal(h.calls.find(c => c[0] === 'update')[1].status, 'paid');
  assert.match(h.calls.find(c => c[0] === 'update')[1].paid_at, /^\d{4}-\d{2}-\d{2}T/);
});
test('missing or failed flag reads disable billing', async () => {
  const { partnerBillingEnabled } = load('../../src/lib/partner-billing.ts', { 'server-only': {} });
  for (const result of [{ data: null }, { data: { enabled: true }, error: { message: 'unavailable' } }, { data: { enabled: false } }]) {
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return result; } };
    assert.equal(await partnerBillingEnabled({ from() { return query; } }), false);
  }
});

test('broker and insurer invoice totals come from configured plans; read failures prevent invoicing', async () => {
  for (const [type, fee, readFailure] of [['broker', 137.25, false], ['insurer', 583.4, false], ['insurer', 583.4, true]]) {
    let inserted;
    const orgId = 'b2000000-0000-4000-8000-000000000001';
    const rows = {
      organizations: { id: orgId, slug: 'test-partner', type, name: 'Test partner' },
      subscriptions: { status: 'active', plan: { name: 'Agreed fee', code: 'agreed_fee', currency: 'GHS', monthly_fee: fee, included_requests: null, per_request_fee: 0, per_active_policy_fee: 0 } },
      invoices: null, usage_events: [], platform_settings: null,
    };
    const supabase = { from(table) {
      let writing = false;
      const result = () => ({ data: writing ? { id: 'new-invoice' } : rows[table], error: readFailure && table === 'usage_events' ? { message: 'Usage unavailable' } : null });
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, neq() { return query; },
        gte() { return query; }, lt() { return query; }, limit() { return query; },
        async single() { return result(); }, async maybeSingle() { return result(); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
        insert(value) { inserted = value; writing = true; return query; },
      };
      return query;
    } };
    const { generateInvoice } = load('../../src/app/(admin)/invoices/actions.ts', {
      '@im/core': { canTransitionPartnerInvoice },
      '@/lib/partner-billing': { partnerBillingEnabled: async () => true },
      '@/lib/billing': load('../../src/lib/billing.ts', {}),
      'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
      '@/lib/actions': {
        authorize: async () => ({ ok: true, supabase }), formObject: fd => Object.fromEntries(fd),
        fail: error => ({ ok: false, error }), dbMessage: error => error.message,
      },
    });
    const fd = new FormData(); fd.set('orgId', orgId); fd.set('period', '2026-10');
    if (readFailure) {
      assert.equal((await generateInvoice({}, fd)).ok, false);
      assert.equal(inserted, undefined);
    } else {
      await assert.rejects(generateInvoice({}, fd), /redirect:\/invoices\/new-invoice/);
      assert.equal(inserted.total, fee);
      assert.equal(inserted.lines[0].unit_price, fee);
      assert.match(inserted.lines[0].description, /platform fee/);
      assert.equal(inserted.status, 'draft');
    }
  }
});
