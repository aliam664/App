import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { verifyUpdateSignature } from '../scripts/update-signature';
import productionKey from '../config/updater-public.json';
const path = 'src-tauri/tests/fixtures/';
const bytes = readFileSync(`${path}updater-payload.txt`);
const signature = readFileSync(`${path}updater-payload.txt.sig`, 'utf8');
const key = readFileSync(`${path}updater-public.txt`, 'utf8');
it('verifies a real Tauri CLI signature and rejects bytes, key and version tampering', () => {
  expect(() => verifyUpdateSignature(bytes, signature, key, '0.1.0')).not.toThrow();
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  expect(() => verifyUpdateSignature(changed, signature, key, '0.1.0')).toThrow();
  expect(() =>
    verifyUpdateSignature(bytes, signature, productionKey.public_key, '0.1.0'),
  ).toThrow();
  expect(() => verifyUpdateSignature(bytes, signature, key, '99.0.0')).toThrow();
  const comment = Buffer.from(
    Buffer.from(signature.trim(), 'base64').toString().replace('version:0.1.0', 'version:99.0.0'),
  ).toString('base64');
  expect(() => verifyUpdateSignature(bytes, comment, key, '99.0.0')).toThrow();
});
