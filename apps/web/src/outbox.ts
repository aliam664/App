import { api } from './api';
import { proof } from './device';
import { localStore } from './storage';
import { staticPreview } from './runtime';
import type { ClientEvent } from '../../../packages/contracts/src/index';
export const sessionId = crypto.randomUUID();
type Pending = ClientEvent & { license_id: string };
let opened: Promise<IDBDatabase> | undefined;
function db() {
  return (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(staticPreview ? 'uhm-pages-outbox-v1' : 'uhm-outbox-v1', 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore('events', { keyPath: ['license_id', 'id'] });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      opened = undefined;
      reject(r.error);
    };
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('events', mode);
    const request = run(tx.objectStore('events'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function pendingEvents() {
  return transaction('readonly', (store) => store.getAll()) as Promise<Pending[]>;
}
export async function recordEvent(
  type: ClientEvent['type'],
  fields: Partial<Omit<ClientEvent, 'id' | 'type' | 'session_id' | 'occurred_at'>> = {},
) {
  const license = JSON.parse(localStore.getItem('uhm-license') || 'null');
  if (!license?.id) return; // Never invent a license attribution before activation.
  const event: Pending = {
    ...fields,
    id: type === 'app_open' ? sessionId : crypto.randomUUID(),
    type,
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    license_id: license.id,
    app_version: '0.1.0',
  };
  try {
    await transaction('readwrite', (store) => store.put(event));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('outbox-error'));
    throw e;
  }
  scheduleFlush();
}
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleFlush() {
  if (!flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushEvents();
    }, 10000);
}
let flushing = false;
export async function flushEvents() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const license = JSON.parse(localStore.getItem('uhm-license') || 'null');
    if (!license?.id) return;
    for (let round = 0; round < 5; round++) {
      const batch = (await pendingEvents())
        .filter((e) => e.license_id === license.id)
        .slice(0, 100);
      if (!batch.length) break;
      const response = await api<{ accepted: string[] }>('/telemetry/batch', {
        license_id: license.id,
        ...(await proof('telemetry')),
        events: batch.map(({ license_id, ...event }) => event),
      });
      const accepted = new Set(response.accepted);
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction('events', 'readwrite');
        const store = tx.objectStore('events');
        batch.filter((e) => accepted.has(e.id)).forEach((e) => store.delete([e.license_id, e.id]));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (!accepted.size) break;
    }
  } catch {
    /* Retain every unacknowledged event; retry after reconnection/restart. */
  } finally {
    flushing = false;
  }
}
window.addEventListener('online', () => void flushEvents());
setInterval(() => void flushEvents(), 60000);
