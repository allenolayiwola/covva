import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(url, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, { exports, require: id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) return load(new URL(`${id}.tsx`, url));
    return require(id);
  } });
  return exports;
}
const ui = load(new URL('../../../../packages/ui/src/index.tsx', import.meta.url));
for (const demo of [true, false]) {
  test(`marketing footer renders exactly ${demo ? 'one' : 'no'} visible demo badge when demo mode is ${demo}`, async () => {
    const { SiteFooter } = load(new URL('../../src/components/marketing/site-footer.tsx', import.meta.url), {
      'next/link': ({ children, ...props }) => React.createElement('a', props, children),
      '@im/ui': ui,
      '@im/core': { ROLE_STATEMENTS: { platform: 'Technology platform', payment: 'Payment disclosure' } },
      './payments-disclosure': { PAYMENTS_DISCLOSURE: 'Payment disclosure' },
      './trust-copy': { TRUST_STATEMENT: 'Trust statement' },
      './brand': { getBrand: async () => ({ name: 'Covva', tagline: 'Insurance', supportEmail: 'help@example.test' }), getCurrentYear: async () => 2026, isDemoMode: async () => demo },
      './content': { REGULATION: { nic: { url: 'https://example.test' } } },
      './store-badges': { StoreBadges: () => null },
      './payment-badges': { PaymentBadges: () => null },
      './products-content': { PRODUCT_LINES: [] },
      '@/lib/i18n/client': { T: ({ k }) => k },
    });
    const html = renderToStaticMarkup(await SiteFooter());
    assert.equal((html.match(/Illustrative only\. Insurers shown are not partners\. · Demo data/g) ?? []).length, demo ? 1 : 0);
    if (demo) assert.match(html, /<span class="[^"]*inline-block[^" ]*(?: [^" ]+)*">Illustrative only/);
  });
}
