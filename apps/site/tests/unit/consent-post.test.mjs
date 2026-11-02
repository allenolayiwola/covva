import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideConsentPost } from '../../src/lib/consent-post.ts';

const base = {
  choice: 'essential',
  requestUrl: 'https://covva.com.gh/api/consent',
  origin: 'https://covva.com.gh',
  secFetchSite: 'same-origin',
  referer: 'https://covva.com.gh/insurance/motor?ref=ABC',
  pixelsConfigured: false,
};

test('a same-origin Reject stores essential and returns to the page with the saved marker', () => {
  const r = decideConsentPost(base);
  assert.equal(r.ok, true);
  assert.equal(r.choice, 'essential');
  assert.equal(r.location, '/insurance/motor?ref=ABC#consent-saved');
  assert.match(r.cookie, /^covva_consent=essential; Max-Age=15552000; Path=\/; SameSite=Lax; Secure$/);
});

test('cross-site posts are refused, so another site cannot opt a visitor in', () => {
  assert.deepEqual(decideConsentPost({ ...base, choice: 'all', secFetchSite: 'cross-site' }), { ok: false, status: 403 });
  assert.deepEqual(decideConsentPost({ ...base, secFetchSite: 'same-site' }), { ok: false, status: 403 });
  // Without Sec-Fetch-Site, the Origin header must match.
  assert.deepEqual(decideConsentPost({ ...base, secFetchSite: null, origin: 'https://evil.example' }), { ok: false, status: 403 });
  assert.deepEqual(decideConsentPost({ ...base, secFetchSite: null, origin: null }), { ok: false, status: 403 });
  assert.equal(decideConsentPost({ ...base, secFetchSite: null }).ok, true);
});

test('only the three known choices are accepted', () => {
  for (const choice of ['', 'everything', null, undefined, 42]) {
    assert.deepEqual(decideConsentPost({ ...base, choice }), { ok: false, status: 400 }, String(choice));
  }
  assert.equal(decideConsentPost({ ...base, choice: 'analytics' }).choice, 'analytics');
});

test('"all" is stored only when an advertising pixel is configured', () => {
  assert.equal(decideConsentPost({ ...base, choice: 'all' }).choice, 'analytics');
  assert.equal(decideConsentPost({ ...base, choice: 'all', pixelsConfigured: true }).choice, 'all');
});

test('the redirect never leaves the site', () => {
  assert.equal(decideConsentPost({ ...base, referer: 'https://evil.example/phish' }).location, '/#consent-saved');
  assert.equal(decideConsentPost({ ...base, referer: 'not a url' }).location, '/#consent-saved');
  assert.equal(decideConsentPost({ ...base, referer: null }).location, '/#consent-saved');
});

test('the cookie is not marked Secure on plain http (local development)', () => {
  const r = decideConsentPost({ ...base, requestUrl: 'http://localhost:3100/api/consent', origin: 'http://localhost:3100', referer: 'http://localhost:3100/' });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.cookie, /Secure/);
  assert.equal(r.location, '/#consent-saved');
});
