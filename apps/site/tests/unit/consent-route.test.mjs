import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../src/app/api/consent/route.ts';

const post = (fields, headers = {}) => {
  const body = new URLSearchParams(fields);
  return POST(new Request('http://localhost:3100/api/consent', { method: 'POST', body, headers: { host: 'localhost:3100', 'content-type': 'application/x-www-form-urlencoded', ...headers } }));
};
const same = { origin: 'http://localhost:3100', referer: 'http://localhost:3100/insurance/motor?ref=AB' };

test('Reject sets the essential cookie and redirects back to the referring page', async () => {
  const res = await post({ choice: 'essential' }, same);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/insurance/motor?ref=AB#cookie-consent');
  assert.equal(res.headers.get('set-cookie'), 'covva_consent=essential; Max-Age=15552000; Path=/; SameSite=Lax');
});

test('"all" is stored as analytics when no pixel is configured', async () => {
  const res = await post({ choice: 'all' }, same);
  assert.match(res.headers.get('set-cookie'), /^covva_consent=analytics;/);
});

test('invalid choices and cross-site posts are refused', async () => {
  assert.equal((await post({ choice: 'marketing' }, same)).status, 400);
  assert.equal((await post({}, same)).status, 400);
  assert.equal((await post({ choice: 'essential' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ choice: 'essential' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ choice: 'essential' }, { referer: 'https://evil.example/x' })).status, 403);
});

test('redirect never leaves the site', async () => {
  const offsite = await post({ choice: 'essential' }, { 'sec-fetch-site': 'same-origin', referer: 'https://evil.example/x' });
  assert.equal(offsite.headers.get('location'), '/#cookie-consent');
  const none = await post({ choice: 'essential' }, { origin: 'http://localhost:3100' });
  assert.equal(none.headers.get('location'), '/#cookie-consent');
});

test('Secure is added on https', async () => {
  const res = await POST(new Request('https://covva.com.gh/api/consent', { method: 'POST', body: new URLSearchParams({ choice: 'essential' }), headers: { host: 'covva.com.gh', origin: 'https://covva.com.gh' } }));
  assert.match(res.headers.get('set-cookie'), /; Secure$/);
});
