import { invoke, isTauri } from '@tauri-apps/api/core';
import { staticPreview } from './runtime';
import { api } from './api';
const native = isTauri();
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
let browserKey: CryptoKeyPair | null = null;
async function keys(): Promise<CryptoKeyPair> {
  if (browserKey) return browserKey;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(staticPreview ? 'uhm-pages-device-preview' : 'uhm-device-preview', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const saved = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
    const r = db.transaction('keys').objectStore('keys').get('identity');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  if (saved) {
    browserKey = saved;
    db.close();
    return saved;
  }
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(key, 'identity');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  browserKey = key;
  return key;
}
export async function proof(purpose: string) {
  const key = native ? null : await keys();
  const public_key = native
    ? await invoke<JsonWebKey>('device_identity')
    : await crypto.subtle.exportKey('jwk', key!.publicKey);
  const publicOnly = { kty: public_key.kty, crv: public_key.crv, x: public_key.x, y: public_key.y };
  const challenge = await api('/device/challenge', { public_key: publicOnly, purpose });
  const signature = native
    ? await invoke<string>('sign_challenge', { nonce: challenge.nonce })
    : b64(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            key!.privateKey,
            new TextEncoder().encode(`UHM:device-proof:v1:${challenge.nonce}`),
          ),
        ),
      );
  return { public_key: publicOnly, signature, challenge_id: challenge.id };
}
export { native, invoke };
