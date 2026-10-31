import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminPasswordResetUrl } from '../../src/lib/site-url.ts';

function environment(t, mode, adminUrl) {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  process.env.NODE_ENV = mode;
  if (adminUrl === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL;
  else process.env.NEXT_PUBLIC_ADMIN_URL = adminUrl;
}

test('recovery targets the configured admin site even on a different browser host', t => {
  environment(t, 'production', 'https://admin.example.test/');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://preview.example.test' } },
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  assert.equal(adminPasswordResetUrl(), 'https://admin.example.test/reset-password');
});

test('development uses the local admin port when configuration is absent', t => {
  environment(t, 'development');
  assert.equal(adminPasswordResetUrl(), 'http://localhost:3001/reset-password');
});

test('explicit configuration takes precedence in development', t => {
  environment(t, 'development', 'https://admin.example.test');
  assert.equal(adminPasswordResetUrl(), 'https://admin.example.test/reset-password');
});

for (const mode of ['production', 'test']) {
  test(`${mode} rejects missing or blank configuration instead of falling back`, t => {
    environment(t, mode);
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL;
      else process.env.NEXT_PUBLIC_ADMIN_URL = value;
      assert.throws(() => adminPasswordResetUrl(), /NEXT_PUBLIC_ADMIN_URL is required/);
    }
  });
}

test('invalid admin URLs cannot become recovery redirects', t => {
  environment(t, 'production');
  for (const value of ['/relative', 'not a URL', 'javascript:alert(1)', 'https://user:pass@admin.example.test']) {
    process.env.NEXT_PUBLIC_ADMIN_URL = value;
    assert.throws(() => adminPasswordResetUrl());
  }
});
