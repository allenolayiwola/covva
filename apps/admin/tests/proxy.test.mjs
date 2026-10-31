import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const requireFromApp = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import ts from 'typescript';
const { unstable_doesMiddlewareMatch } = requireFromApp('next/experimental/testing/server');
function loadSource(relative) {
  const filename = path.resolve(__dirname, relative);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { config, proxy } = loadSource('../src/proxy.ts');
test('only the exact health endpoint is newly excluded from auth middleware', () => {
  assert.equal(unstable_doesMiddlewareMatch({ config, url: '/api/health' }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, url: '/api/health?probe=1' }), false);
  for (const url of ['/', '/settings', '/api', '/api/health/', '/api/health/details', '/api/healthcheck', '/api/health-secret', '/api/Health', '/api/other']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  }
});
test('unauthenticated ordinary admin GETs still redirect to sign-in', async () => {
  const { NextRequest } = requireFromApp('next/server');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:59999';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-only';
  for (const path of ['/', '/settings', '/api/health/details', '/api/healthcheck', '/api/other']) {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location')).pathname, '/sign-in');
  }
});
test('health GET is independent of auth and exposes only status and version', async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { GET } = loadSource('../src/app/api/health/route.ts');
  const response = GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', version: requireFromApp('../package.json').version });
});
