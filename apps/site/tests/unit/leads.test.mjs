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

test('server action rejects normal invalid submissions before database access', async () => {
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
    for (const started_at of [String(Date.now() - 5000)]) {
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

test('both spam guards return generic success before either schema or database access', async () => {
  const source = readFileSync(new URL('../../src/app/(site)/(marketing)/actions.ts', import.meta.url), 'utf8');
  const exports = {};
  const unreachable = () => { throw new Error('Spam must skip validation and database access'); };
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    if (name.endsWith('/lead-schema')) return { LeadSchema: { safeParse: unreachable }, RenewalLeadSchema: { safeParse: unreachable } };
    if (name.endsWith('/supabase/server')) return { createClient: unreachable };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  for (const action of [exports.submitLead, exports.submitRenewalLead]) {
    for (const fields of [valid, { email: 'invalid', consent: '' }]) {
      for (const guard of [
        { company_website: 'https://spam.example', started_at: String(Date.now() - 5000) },
        { started_at: String(Date.now()) },
        { started_at: String(Date.now() + 1000) },
      ]) {
        const data = new FormData();
        for (const [key, value] of Object.entries({ ...fields, ...guard })) data.set(key, value);
        assert.deepEqual(await action({ status: 'idle' }, data), { status: 'success' });
      }
    }
  }
});

// Exercise the component's submit handler with lightweight hook/element stubs.
// Effects and DOM rendering are outside this validation contract.
function renderLeadForm(props) {
  const states = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => [initial, value => states.push(value)],
    useActionState: () => [{ status: 'idle' }, () => {}, false],
    useRef: () => ({ current: null }),
    useId: () => 'lead',
    useEffect: () => {},
  };
  const source = readFileSync(new URL('../../src/components/marketing/lead-form.tsx', import.meta.url), 'utf8');
  const exports = {};
  new Function('require', 'exports', 'FormData', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText)(name => {
    if (name === 'react') return react;
    if (name === './lead-schema') return schemaExports;
    if (name === '@im/ui') return { cn: () => '' };
    if (['next/link', 'lucide-react', '@/app/(site)/(marketing)/actions', './analytics'].includes(name)) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports, class { constructor(fields) { return Object.entries(fields); } });
  const instance = exports.LeadForm(props);
  const form = instance.type(instance.props);
  assert.equal(form.type, 'form');
  return { states, submit(fields) {
    let prevented = false;
    form.props.onSubmit({ currentTarget: fields, preventDefault: () => { prevented = true; } });
    return prevented;
  } };
}

test('LeadForm defaults to LeadSchema and clears client errors for valid submissions', () => {
  const form = renderLeadForm({});
  assert.equal(form.submit({ ...valid, email: 'invalid', consent: undefined }), true);
  assert.ok(form.states.at(-1).fieldErrors.email);
  assert.ok(form.states.at(-1).fieldErrors.consent);
  assert.equal(form.submit(valid), false);
  assert.equal(form.states.at(-1), null);
});

test('LeadForm uses its supplied schema for validation and error messages', () => {
  const schema = LeadSchema.refine(value => value.message === 'Approved', { path: ['message'], message: 'Please use the approved message.' });
  const form = renderLeadForm({ schema });
  assert.equal(form.submit(valid), true);
  assert.equal(form.states.at(-1).fieldErrors.message, 'Please use the approved message.');
  assert.equal(form.submit({ ...valid, message: 'Approved' }), false);
  assert.equal(form.states.at(-1), null);
});
