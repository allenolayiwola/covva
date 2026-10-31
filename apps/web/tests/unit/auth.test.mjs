import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../../src/components/customer/utils.ts';
test('next preserves allowed internal destinations and rejects external ones', () => {
  for (const path of ['/account', '/account/policies?filter=active', '/partner/register', '/quote?resume=1']) assert.equal(safeNext(path), path);
  for (const path of [undefined, ['/account'], 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) assert.equal(safeNext(path), '/account');
});
