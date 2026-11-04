import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payerEmail } from '../../src/server/payer-email.ts';

test('real addresses are kept (trimmed, lower-cased)', () => {
  assert.equal(payerEmail(' Ama@Gmail.com ', 'customer-1'), 'ama@gmail.com');
  assert.equal(payerEmail('ops@covva.com.gh', 'customer-1'), 'ops@covva.com.gh');
  assert.equal(payerEmail('me@mytest.com', 'customer-1'), 'me@mytest.com');
});

test('missing or reserved test domains get the Covva stand-in', () => {
  for (const e of [null, undefined, '', 'no-at-sign', 'ama@demo-customer.example', 'x@foo.test', 'x@foo.invalid', 'x@localhost', 'x@example.com', 'x@example.org']) {
    assert.equal(payerEmail(e, 'customer-ab12cd34'), 'customer-ab12cd34@payments.covva.com.gh', String(e));
  }
});
