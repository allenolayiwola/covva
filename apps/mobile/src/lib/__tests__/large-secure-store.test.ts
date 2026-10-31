import * as SecureStore from 'expo-secure-store';
import { LargeSecureStore } from '../large-secure-store';
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `generation-${++n}` }; });
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { values.delete(key); });
});
it('round trips large Unicode sessions with each value below 2 KB', async () => {
  const value = JSON.stringify({ token: 'a'.repeat(6000), name: '👩🏽漢字'.repeat(1200) });
  await LargeSecureStore.setItem('session', value);
  expect(await LargeSecureStore.getItem('session')).toBe(value);
  expect(values.size).toBeGreaterThan(2);
  for (const chunk of values.values()) expect(encodeURIComponent(chunk).replace(/%[A-F\d]{2}/g, 'x').length).toBeLessThan(2000);
});
it('removes old chunks when replacing a long session with a shorter one', async () => {
  await LargeSecureStore.setItem('session', 'x'.repeat(5000));
  const oldKeys = [...values.keys()].filter(k => k !== 'session');
  await LargeSecureStore.setItem('session', 'short');
  expect(await LargeSecureStore.getItem('session')).toBe('short');
  expect(oldKeys.every(key => !values.has(key))).toBe(true);
  expect(values.size).toBe(2);
  await LargeSecureStore.removeItem('session');
  expect(values.size).toBe(0);
  expect(await LargeSecureStore.getItem('session')).toBeNull();
});
it('preserves the previous session after a partial write failure', async () => {
  await LargeSecureStore.setItem('session', 'original');
  const original = new Map(values);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    if (key.endsWith('.1')) throw new Error('Device storage full');
    values.set(key, value);
  });
  await expect(LargeSecureStore.setItem('session', 'x'.repeat(900))).rejects.toThrow('Device storage full');
  expect(await LargeSecureStore.getItem('session')).toBe('original');
  expect(values).toEqual(original);
});
it('serializes overlapping writes and removal', async () => {
  await Promise.all([LargeSecureStore.setItem('session', 'a'.repeat(2000)), LargeSecureStore.setItem('session', 'b'), LargeSecureStore.removeItem('session')]);
  expect(values.size).toBe(0);
});
it('rejects incomplete sessions instead of returning truncated tokens', async () => {
  await LargeSecureStore.setItem('session', 'a'.repeat(900));
  values.delete([...values.keys()].find(k => k.endsWith('.1'))!);
  await expect(LargeSecureStore.getItem('session')).rejects.toThrow('Incomplete secure session');
});
