import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

// At most 1,600 UTF-8 bytes, even for surrogate pairs: below SecureStore's 2 KB limit.
const CHUNK_SIZE = 400;
type Manifest = { generation: string; count: number };
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
async function manifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as Manifest;
  if (typeof value.generation !== 'string' || !/^[a-zA-Z0-9-]+$/.test(value.generation) || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 10000) {
    throw new Error('Invalid secure session manifest');
  }
  return value;
}
const chunkKey = (key: string, m: Manifest, index: number) => `${key}.${m.generation}.${index}`;
async function cleanup(key: string, m: Manifest | null) {
  if (m) await Promise.all(Array.from({ length: m.count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, m, i))));
}

export const LargeSecureStore = {
  getItem(key: string): Promise<string | null> {
    return serial(key, async () => {
      const m = await manifest(key);
      if (!m) return null;
      const chunks = await Promise.all(Array.from({ length: m.count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, m, i))));
      if (chunks.some(c => c === null)) throw new Error('Incomplete secure session');
      return chunks.join('');
    });
  },
  setItem(key: string, value: string): Promise<void> {
    return serial(key, async () => {
      const old = await manifest(key);
      const characters = Array.from(value);
      const m = { generation: randomUUID(), count: Math.ceil(characters.length / CHUNK_SIZE) };
      try {
        for (let i = 0; i < m.count; i++) {
          await SecureStore.setItemAsync(chunkKey(key, m, i), characters.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).join(''));
        }
        // Commit only after all chunks are durable. A failed write preserves the old session.
        await SecureStore.setItemAsync(key, JSON.stringify(m));
      } catch (error) {
        await cleanup(key, m).catch(() => {});
        throw error;
      }
      await cleanup(key, old);
    });
  },
  removeItem(key: string): Promise<void> {
    return serial(key, async () => {
      const old = await manifest(key);
      await SecureStore.deleteItemAsync(key);
      await cleanup(key, old);
    });
  },
};
