import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, appPath, siteUrl, sitePath } from '../../src/lib/site-url.ts';

const { default: robots } = await import('../../src/app/robots.ts');

test('app origin: NEXT_PUBLIC_APP_URL, then the Vercel hostnames, then the production default', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '', VERCEL_URL: '' });
  assert.equal(appUrl(), 'https://app.covva.com.gh');
  process.env.VERCEL_URL = 'covva-app-abc.vercel.app';
  assert.equal(appUrl(), 'https://covva-app-abc.vercel.app');
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'covva-app.vercel.app';
  assert.equal(appUrl(), 'https://covva-app.vercel.app');
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test/';
  assert.equal(appUrl(), 'https://app.example.test');
  assert.equal(appPath('/account'), 'https://app.example.test/account');
});

test('site origin in the app never falls back to the app\'s own Vercel hostname', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: '', VERCEL_PROJECT_PRODUCTION_URL: 'covva-app.vercel.app', VERCEL_URL: 'covva-app-abc.vercel.app' });
  assert.equal(siteUrl(), 'https://covva.com.gh');
  process.env.NEXT_PUBLIC_SITE_URL = 'covva-site.vercel.app';
  assert.equal(siteUrl(), 'https://covva-site.vercel.app');
  assert.equal(sitePath('/learn'), 'https://covva-site.vercel.app/learn');
});

test('local development falls back to the documented ports', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '', VERCEL_URL: '' });
  assert.equal(siteUrl(), 'http://localhost:3100');
  assert.equal(appUrl(), 'http://localhost:3102');
});

test('the app is never indexed', () => {
  assert.deepEqual(robots(), { rules: [{ userAgent: '*', disallow: '/' }] });
});
