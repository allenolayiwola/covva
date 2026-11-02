import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../../src/components/customer/utils.ts';
test('next preserves allowed internal destinations and rejects external ones', () => {
  for (const path of ['/account', '/account/policies?filter=active', '/partner/register', '/quote?resume=1']) assert.equal(safeNext(path), path);
  for (const path of [undefined, ['/account'], 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) assert.equal(safeNext(path), '/account');
});

const { mfaRequiredFor, partnerMfaRequired } = await import('../../src/lib/partner-mfa.ts');
const org = (require_mfa) => ({ org: { require_mfa } });

test('platform MFA switch: explicit values win, otherwise on only in production', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', PARTNER_MFA_REQUIRED: '' });
  assert.equal(partnerMfaRequired(), true);
  for (const v of ['false', '0', ' FALSE ']) { process.env.PARTNER_MFA_REQUIRED = v; assert.equal(partnerMfaRequired(), false); }
  process.env.NODE_ENV = 'development';
  process.env.PARTNER_MFA_REQUIRED = '';
  assert.equal(partnerMfaRequired(), false);
  for (const v of ['true', '1']) { process.env.PARTNER_MFA_REQUIRED = v; assert.equal(partnerMfaRequired(), true); }
});

test('partner MFA (gate and /partner/mfa) is required only when the platform switch is on and an organisation requires it', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', PARTNER_MFA_REQUIRED: '' });
  // Platform on (production default): any organisation that has not opted out requires it.
  assert.equal(mfaRequiredFor([org(true)]), true);
  assert.equal(mfaRequiredFor([org(false), org(true)]), true);
  assert.equal(mfaRequiredFor([org(null)]), true);
  // Every organisation opted out (the demo partners), or no partner membership: nothing to verify.
  assert.equal(mfaRequiredFor([org(false)]), false);
  assert.equal(mfaRequiredFor([org(false), org(false)]), false);
  assert.equal(mfaRequiredFor([]), false);
  // Platform off: never required, whatever the organisation says.
  process.env.PARTNER_MFA_REQUIRED = 'false';
  assert.equal(mfaRequiredFor([org(true)]), false);
});
