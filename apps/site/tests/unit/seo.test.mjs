import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteUrl, sitePath } from '../../src/lib/site-url.ts';
import { pageCopy, pageMetadata } from '../../src/lib/seo.ts';

test('site origin precedence, hostname normalization and final fallback', t => {
  t.mock.property(process, 'env', { ...process.env, NEXT_PUBLIC_SITE_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '', VERCEL_URL: '' });
  assert.equal(siteUrl(), 'https://covva.com.gh');
  process.env.VERCEL_URL = 'preview.example.test';
  assert.equal(siteUrl(), 'https://preview.example.test');
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'production.example.test';
  assert.equal(siteUrl(), 'https://production.example.test');
  process.env.NEXT_PUBLIC_SITE_URL = 'https://configured.example.test/';
  assert.equal(siteUrl(), 'https://configured.example.test');
  assert.equal(sitePath('/sitemap.xml'), 'https://configured.example.test/sitemap.xml');
});

test('home and route metadata emit absolute OG images on the configured site', t => {
  t.mock.property(process, 'env', { ...process.env, NEXT_PUBLIC_SITE_URL: 'https://configured.example.test' });
  const titles = new Set(), descriptions = new Set();
  for (const copy of [...Object.values(pageCopy), { title: 'Motor cover in Ghana', description: 'Motor cover through licensed partners.', path: '/insurance/motor' }]) {
    const metadata = pageMetadata(copy);
    assert.equal(metadata.alternates.canonical, sitePath(copy.path));
    assert.equal(metadata.openGraph.url, sitePath(copy.path));
    assert.deepEqual(metadata.openGraph.images, [sitePath(copy.path === '/' ? '/opengraph-image' : `${copy.path}/opengraph-image`)]);
    assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
    assert(!titles.has(metadata.title)); titles.add(metadata.title);
    assert(!descriptions.has(metadata.description)); descriptions.add(metadata.description);
    assert(!JSON.stringify(metadata).includes('covva.com.gh'));
  }
});

const { default: robots } = await import('../../src/app/robots.ts');
const { rootMetadata } = await import('../../src/lib/root-metadata.ts');

for (const [vercelEnv, nodeEnv, production] of [
  ['preview', 'production', false],
  ['development', 'production', false],
  ['production', 'production', true],
  ['production', 'development', true],
  [undefined, 'production', true],
  [undefined, 'development', false],
  [undefined, 'test', false],
  [undefined, undefined, false],
]) {
  test(`indexing with VERCEL_ENV=${vercelEnv}, NODE_ENV=${nodeEnv}`, t => {
    const env = { ...process.env, NEXT_PUBLIC_SITE_URL: 'https://configured.example.test' };
    delete env.VERCEL_ENV;
    delete env.NODE_ENV;
    if (vercelEnv !== undefined) env.VERCEL_ENV = vercelEnv;
    if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
    t.mock.property(process, 'env', env);

    if (production) {
      assert.equal(rootMetadata().robots, undefined);
      assert.deepEqual(robots(), {
        rules: [{
          userAgent: '*',
          allow: '/',
          disallow: ['/account', '/partner$', '/partner/', '/api/', '/sign-in', '/sign-up'],
        }],
        sitemap: 'https://configured.example.test/sitemap.xml',
        host: 'https://configured.example.test',
      });
    } else {
      assert.deepEqual(rootMetadata().robots, { index: false, follow: false });
      assert.deepEqual(robots(), { rules: [{ userAgent: '*', disallow: '/' }] });
      assert.equal(robots().sitemap, undefined);
    }
  });
}
