import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_PATH, decideGate, gateDigest, isGateOpenPath, readGateConfig } from '../../src/lib/site-gate.ts';

const TOKEN = 'team-preview-secret-123';
const on = (extra = {}) => readGateConfig({ SITE_GATE: 'waitlist', SITE_GATE_BYPASS_TOKEN: TOKEN, ...extra });

async function decide({ config = on(), host = 'covva.com.gh', url = 'https://covva.com.gh/', cookie = null } = {}) {
  const tokenDigest = config.bypassToken ? await gateDigest(config.bypassToken) : null;
  const param = new URL(url).searchParams.get('preview');
  return decideGate({ config, host, url, bypassCookie: cookie, tokenDigest, paramDigest: param && param !== 'off' ? await gateDigest(param) : null });
}

test('the gate is off unless SITE_GATE=waitlist', async () => {
  for (const SITE_GATE of [undefined, '', 'off', 'true', '1']) {
    const config = readGateConfig({ SITE_GATE, SITE_GATE_BYPASS_TOKEN: TOKEN });
    assert.equal(config.on, false, String(SITE_GATE));
    assert.deepEqual(await decide({ config }), { kind: 'off' });
  }
  assert.equal(readGateConfig({ SITE_GATE: ' Waitlist ' }).on, true);
});

test('every page shows the waitlist while gated, app paths included', async () => {
  for (const path of ['/', '/insurance/motor', '/waitlist', '/quote?type=motor', '/account', '/sign-in', '/learn/what-is-third-party']) {
    assert.deepEqual(await decide({ url: `https://covva.com.gh${path}` }), { kind: 'gate' }, path);
  }
});

test('legal pages, APIs, crawler files and share images stay reachable', async () => {
  for (const path of [GATE_PATH, '/verify', '/legal/privacy', '/legal/terms', '/legal/cookies', '/api/consent', '/robots.txt', '/sitemap.xml', '/opengraph-image', '/about/opengraph-image', '/manifest.webmanifest']) {
    assert.equal(isGateOpenPath(path), true, path);
    assert.deepEqual(await decide({ url: `https://covva.com.gh${path}` }), { kind: 'open' }, path);
  }
  for (const path of ['/', '/legal', '/legalese', '/apis', '/coming-soonish', '/verifyx', '/verification']) assert.equal(isGateOpenPath(path), false, path);
  assert.deepEqual(await decide({ url: 'https://covva.com.gh/verify?q=JKB67GVDSY' }), { kind: 'open' }, 'QR links on certificates still work while gated');
});

test('SITE_GATE_HOSTS limits the gate to those hostnames (port and case ignored)', async () => {
  const config = on({ SITE_GATE_HOSTS: 'covva.com.gh, WWW.covva.com.gh' });
  assert.deepEqual(config.hosts, ['covva.com.gh', 'www.covva.com.gh']);
  assert.deepEqual(await decide({ config, host: 'Covva.com.gh' }), { kind: 'gate' });
  assert.deepEqual(await decide({ config, host: 'www.covva.com.gh:443' }), { kind: 'gate' });
  assert.deepEqual(await decide({ config, host: 'covva-site.vercel.app' }), { kind: 'off' });
  assert.deepEqual(await decide({ config, host: null }), { kind: 'off' });
  assert.equal(on().hosts, null, 'unset = every host');
});

test('a valid preview link sets the cookie and drops the secret from the URL', async () => {
  const d = await decide({ url: `https://covva.com.gh/insurance/motor?ref=ABC&preview=${TOKEN}` });
  assert.equal(d.kind, 'set-bypass');
  assert.equal(d.location, '/insurance/motor?ref=ABC');
  assert.equal(d.cookie, await gateDigest(TOKEN));
  assert.notEqual(d.cookie, TOKEN, 'the cookie never holds the secret itself');
  assert.deepEqual(await decide({ cookie: d.cookie }), { kind: 'bypass' });
  assert.deepEqual(await decide({ cookie: d.cookie, url: 'https://covva.com.gh/legal/terms' }), { kind: 'open' });
});

test('a wrong secret or a forged cookie still sees the waitlist', async () => {
  assert.deepEqual(await decide({ url: 'https://covva.com.gh/?preview=guess-guess-guess-guess' }), { kind: 'gate' });
  assert.deepEqual(await decide({ cookie: TOKEN }), { kind: 'gate' });
  assert.deepEqual(await decide({ cookie: 'yes' }), { kind: 'gate' });
});

test('?preview=off clears the cookie', async () => {
  assert.deepEqual(await decide({ url: 'https://covva.com.gh/about?preview=off' }), { kind: 'clear-bypass', location: '/about' });
});

test('no bypass without a secret of at least 16 characters', async () => {
  for (const SITE_GATE_BYPASS_TOKEN of [undefined, '', 'short-secret']) {
    const config = readGateConfig({ SITE_GATE: 'waitlist', SITE_GATE_BYPASS_TOKEN });
    assert.equal(config.bypassToken, null);
    const tokenDigest = null;
    const paramDigest = await gateDigest(SITE_GATE_BYPASS_TOKEN ?? '');
    assert.deepEqual(decideGate({ config, host: 'covva.com.gh', url: `https://covva.com.gh/?preview=${SITE_GATE_BYPASS_TOKEN ?? ''}`, bypassCookie: paramDigest, tokenDigest, paramDigest }), { kind: 'gate' });
  }
});
