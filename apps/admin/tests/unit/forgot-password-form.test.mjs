import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminPasswordResetUrl } from '../../src/lib/site-url.ts';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL('../../src/app/forgot-password/ForgotPasswordForm.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function formHarness(result) {
  const state = [];
  let cursor = 0;
  const calls = [];
  const exports = {};
  const mocks = {
    react: { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@im/ui': {
      Notice: ({ children }) => React.createElement('div', null, children),
      Field: ({ children }) => React.createElement('label', null, children),
      Input: props => React.createElement('input', props),
      Button: ({ children, loading, ...props }) => React.createElement('button', { ...props, disabled: loading }, children),
    },
    '@/lib/site-url': { adminPasswordResetUrl },
    '@/lib/supabase/client': { createClient() { calls.push('client'); return { auth: { async resetPasswordForEmail(...args) { calls.push(args); if (result instanceof Error) throw result; return result; } } }; } },
  };
  runInNewContext(source, { exports, process, require: id => mocks[id] ?? require(id), FormData: class { get() { return ' staff@example.test '; } } });
  const render = () => { cursor = 0; return exports.ForgotPasswordForm(); };
  return { calls, render, async submit() { render().props.onSubmit({ preventDefault() {}, currentTarget: {} }); await new Promise(resolve => setImmediate(resolve)); } };
}

test('development without admin URL falls back to the local admin port and sends the reset', async t => {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  process.env.NODE_ENV = 'development';
  delete process.env.NEXT_PUBLIC_ADMIN_URL;
  const form = formHarness({ error: null });
  await form.submit();
  const html = renderToStaticMarkup(form.render());
  assert.doesNotMatch(html, /role="alert"/);
  assert.match(html, /you will receive a password reset link/);
  assert.equal(form.calls.length, 2);
  assert.match(form.calls[1][1].redirectTo, /^http:\/\/localhost:\d+\//);
});

for (const mode of ['production', 'test']) {
  test(`missing admin URL shows an error without sending a reset in ${mode}`, async t => {
    const previous = { ...process.env };
    t.after(() => { process.env = previous; });
    process.env.NODE_ENV = mode;
    for (const value of [undefined, '', '   ', '/invalid']) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL;
      else process.env.NEXT_PUBLIC_ADMIN_URL = value;
      const form = formHarness();
      await form.submit();
      const html = renderToStaticMarkup(form.render());
      assert.match(html, /role="alert"/);
      assert.match(html, /Password reset is unavailable right now; contact your administrator/);
      assert.doesNotMatch(html, /you will receive a password reset link/);
      assert.deepEqual(form.calls, []);
    }
  });
}

for (const result of [{ error: null }, { error: { message: 'Unknown account' } }, new Error('Provider unavailable')]) {
  test(`configured recovery keeps the same account-safe result: ${JSON.stringify(result)}`, async t => {
    const previous = { ...process.env };
    t.after(() => { process.env = previous; });
    process.env.NEXT_PUBLIC_ADMIN_URL = 'https://admin.example.test';
    const form = formHarness(result);
    await form.submit();
    assert.match(renderToStaticMarkup(form.render()), /If an account matches that email, you will receive a password reset link/);
    assert.deepEqual(structuredClone(form.calls), ['client', ['staff@example.test', { redirectTo: 'https://admin.example.test/reset-password' }]]);
  });
}
