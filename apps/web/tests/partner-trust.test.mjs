import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVerifiedPartner } from '../src/lib/partner-trust.ts';

const real = { status: 'active', licence_status: 'verified', licence_verified_at: '2026-10-31', settings: {} };
test('only active, verified, non-demo directory partners qualify for the trust strip', () => {
  assert.equal(isVerifiedPartner(real), true);
  assert.equal(isVerifiedPartner({ ...real, settings: { demo: true } }), false);
  for (const status of ['pending', 'suspended', 'inactive']) assert.equal(isVerifiedPartner({ ...real, status }), false);
  for (const licence_status of ['unverified', 'expiring', 'lapsed']) assert.equal(isVerifiedPartner({ ...real, licence_status }), false);
  assert.equal(isVerifiedPartner({ ...real, licence_verified_at: null }), false);
});
