import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subaccountProblem } from '../../src/server/paystack-subaccount-check.ts';

test('a GHS subaccount with no percentage charge is safe', () => {
  assert.equal(subaccountProblem({ active: true, currency: 'GHS', percentage_charge: 0 }, 0), null);
  assert.equal(subaccountProblem({ active: 1, currency: 'ghs', percentage_charge: '0' }, 0), null);
});

test('a percentage charge above the agreed platform share is blocked', () => {
  assert.match(subaccountProblem({ active: true, currency: 'GHS', percentage_charge: 25 }, 0), /25%/);
  assert.match(subaccountProblem({ active: true, currency: 'GHS', percentage_charge: 5 }, 2), /5%/);
  assert.equal(subaccountProblem({ active: true, currency: 'GHS', percentage_charge: 2 }, 2), null);
});

test('missing, inactive, foreign-currency or unreadable subaccounts are blocked', () => {
  assert.ok(subaccountProblem(null, 0));
  assert.ok(subaccountProblem({ active: false, currency: 'GHS', percentage_charge: 0 }, 0));
  assert.ok(subaccountProblem({ active: 0, currency: 'GHS', percentage_charge: 0 }, 0));
  assert.ok(subaccountProblem({ active: true, currency: 'NGN', percentage_charge: 0 }, 0));
  assert.ok(subaccountProblem({ active: true, currency: 'GHS', percentage_charge: 'abc' }, 0));
});
