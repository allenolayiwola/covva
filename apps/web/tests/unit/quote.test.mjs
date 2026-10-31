import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenErrors, toFormValue, riskPayload } from '../../src/components/marketing/quote-flow/model.ts';
const field = { key: 'vehicle_value', label: 'Vehicle value', type: 'currency', required: true, min: 5000, placeholder: '120000' };
test('a vehicle value example never becomes an answer; empty remains required', () => {
  const value = toFormValue(field, undefined);
  assert.equal(value, '');
  assert.deepEqual(screenErrors([field], { vehicle_value: value }), { vehicle_value: 'This is needed for a quote' });
  assert.deepEqual(riskPayload([field], { vehicle_value: value }), {});
  assert.deepEqual(screenErrors([field], { vehicle_value: '120000' }), {});
});
