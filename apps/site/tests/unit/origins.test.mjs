import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, appPath } from '../../src/lib/site-url.ts';

test('app origin on the site: NEXT_PUBLIC_APP_URL, never the site\'s own Vercel hostname', t => {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: '', VERCEL_PROJECT_PRODUCTION_URL: 'covva-site.vercel.app', VERCEL_URL: 'covva-site-abc.vercel.app' });
  assert.equal(appUrl(), 'https://app.covva.com.gh');
  process.env.NEXT_PUBLIC_APP_URL = 'covva-app.vercel.app';
  assert.equal(appUrl(), 'https://covva-app.vercel.app');
  assert.equal(appPath('/quote?type=motor'), 'https://covva-app.vercel.app/quote?type=motor');
  process.env.NEXT_PUBLIC_APP_URL = '';
  process.env.NODE_ENV = 'development';
  assert.equal(appUrl(), 'http://localhost:3102');
});

// app-link.tsx is a TSX module; check its path list without rendering by transpiling just the helper.
test('isAppHref recognises app paths and leaves marketing paths alone', async () => {
  const { readFile } = await import('node:fs/promises');
  const ts = (await import('typescript')).default;
  const source = await readFile(new URL('../../src/components/app-link.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const APP_PATHS');
  const end = source.indexOf('/**', source.indexOf('export function isAppHref'));
  const js = ts.transpileModule(source.slice(start, end) + '\nexport { isAppHref };', { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { isAppHref } = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  for (const href of ['/account', '/account/requests/new?category=motor', '/quote', '/quote?type=home', '/partner/register?type=broker', '/sign-in', '/q/abc', '/consent/t0k']) {
    assert.equal(isAppHref(href), true, href);
  }
  for (const href of ['/', '/partners', '/partners/how-we-score', '/learn', '/insurance/motor', '/claims', '/quotes', '/accounts']) {
    assert.equal(isAppHref(href), false, href);
  }
});
