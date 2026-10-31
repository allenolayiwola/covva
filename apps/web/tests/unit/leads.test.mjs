import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';
import { LEAD_TAGS } from '../../src/components/marketing/lead-tags.ts';
const schemaSource = readFileSync(new URL('../../src/components/marketing/lead-schema.ts', import.meta.url), 'utf8');
const schemaExports = {};
new Function('require', 'exports', ts.transpileModule(schemaSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => {
  if (name === 'zod') return { z };
  if (name === './lead-tags') return { LEAD_TAGS };
  throw new Error(`Unexpected dependency: ${name}`);
}, schemaExports);
const { LeadSchema } = schemaExports;

const valid = { kind: 'customer', name: 'Test Person', email: 'test@example.com', consent: 'on' };
for (const email of ['', 'x', 'person@', undefined]) {
  test(`shared client/server schema rejects email ${String(email)}, even with a phone`, () => {
    const result = LeadSchema.safeParse({ ...valid, email, phone: '0241234567' });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some(issue => issue.path[0] === 'email'));
  });
}
for (const consent of [undefined, '', 'false', 'off']) {
  test(`shared client/server schema requires checked consent: ${String(consent)}`, () => {
    const result = LeadSchema.safeParse({ ...valid, consent });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some(issue => issue.path[0] === 'consent'));
  });
}
test('valid email and explicit consent pass', () => assert.equal(LeadSchema.safeParse(valid).success, true));

test('server action rejects invalid submissions before spam guards or database access', async () => {
  const source = readFileSync(new URL('../../src/app/(site)/(marketing)/actions.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  let databaseCalls = 0;
  const require = name => {
    if (name.endsWith('/lead-schema')) return schemaExports;
    if (name.endsWith('/supabase/server')) return { createClient: () => { databaseCalls++; throw new Error('Database must not be reached'); } };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function('require', 'exports', compiled)(require, exports);
  for (const changes of [{ email: 'x' }, { email: '', phone: '0241234567' }, { consent: '' }, { email: 'x', consent: '' }]) {
    for (const started_at of [String(Date.now()), String(Date.now() - 5000)]) {
      const data = new FormData();
      for (const [key, value] of Object.entries({ ...valid, ...changes, started_at })) data.set(key, value);
      const result = await exports.submitLead({ status: 'idle' }, data);
      assert.equal(result.status, 'error');
      if ('email' in changes) assert.ok(result.fieldErrors.email);
      if ('consent' in changes) assert.ok(result.fieldErrors.consent);
    }
  }
  assert.equal(databaseCalls, 0);
});

test('renewal reminders retain phone-only contact but general enquiries require email', () => {
  const reminder = { ...valid, email: '', phone: '0241234567', tag: 'renewal_reminder', expires_on: '2027-01-01' };
  assert.equal(schemaExports.RenewalLeadSchema.safeParse(reminder).success, true);
  assert.equal(LeadSchema.safeParse(reminder).success, false);
});

test('client FormData omission of unchecked consent is rejected', () => {
  const unchecked = { kind: valid.kind, name: valid.name, email: valid.email };
  const result = LeadSchema.safeParse(unchecked);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path[0] === 'consent'));
});
