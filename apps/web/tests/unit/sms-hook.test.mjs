import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { verifyStandardWebhook } from '../../src/server/providers/signatures.ts';
import { parseSmsHook, otpMessage } from '../../src/server/providers/sms-hook.ts';

const key = randomBytes(32);
const secret = `v1,whsec_${key.toString('base64')}`;
const body = JSON.stringify({ user: { phone: '233241234567' }, sms: { otp: '123456' } });
const sign = (id, ts, raw, k = key) => `v1,${createHmac('sha256', k).update(`${id}.${ts}.${raw}`).digest('base64')}`;
const now = () => String(Math.floor(Date.now() / 1000));

test('Supabase hook signature: valid, with and without the v1, prefix, and with rotated keys', () => {
  const ts = now();
  const headers = { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body) };
  assert.equal(verifyStandardWebhook(body, headers, secret), true);
  assert.equal(verifyStandardWebhook(body, headers, `whsec_${key.toString('base64')}`), true);
  const other = randomBytes(32);
  assert.equal(verifyStandardWebhook(body, { ...headers, signature: `${sign('msg_1', ts, body, other)} ${headers.signature}` }, secret), true);
});

test('Supabase hook signature fails closed', () => {
  const ts = now();
  const good = { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, body) };
  assert.equal(verifyStandardWebhook(body + ' ', good, secret), false, 'tampered body');
  assert.equal(verifyStandardWebhook(body, { ...good, id: 'msg_2' }, secret), false, 'different id');
  assert.equal(verifyStandardWebhook(body, good, `v1,whsec_${randomBytes(32).toString('base64')}`), false, 'wrong secret');
  for (const s of [null, undefined, '']) assert.equal(verifyStandardWebhook(body, good, s), false, 'no secret');
  for (const h of [{ ...good, id: null }, { ...good, timestamp: null }, { ...good, signature: null }]) assert.equal(verifyStandardWebhook(body, h, secret), false);
  const stale = String(Math.floor(Date.now() / 1000) - 301);
  assert.equal(verifyStandardWebhook(body, { id: 'msg_1', timestamp: stale, signature: sign('msg_1', stale, body) }, secret), false, 'stale');
  for (const ts2 of ['NaN', 'Infinity', '1e3', '']) assert.equal(verifyStandardWebhook(body, { id: 'msg_1', timestamp: ts2, signature: sign('msg_1', ts2, body) }, secret), false);
  assert.equal(verifyStandardWebhook(body, { ...good, signature: good.signature.replace('v1,', 'v2,') }, secret), false, 'wrong version');
  assert.equal(verifyStandardWebhook(body, { ...good, signature: 'v1,' }, secret), false, 'empty signature');
});

test('SMS hook payload parsing', () => {
  assert.deepEqual(parseSmsHook(body), { ok: true, phone: '233241234567', otp: '123456' });
  for (const raw of ['not json', '{}', JSON.stringify({ user: {}, sms: { otp: '123456' } }), JSON.stringify({ user: { phone: '233241234567' }, sms: { otp: '' } }), JSON.stringify({ user: { phone: '233241234567' }, sms: { otp: '12ab56' } })]) {
    assert.equal(parseSmsHook(raw).ok, false, raw);
  }
});

test('OTP message is one SMS segment and has no link', () => {
  const m = otpMessage('123456');
  assert.match(m, /123456/);
  assert.ok(m.length <= 160);
  assert.doesNotMatch(m, /https?:/);
});
