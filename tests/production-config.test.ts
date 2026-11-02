import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from '../config/production-public.json';
it('versions only browser-safe deployment settings and matching public trust', () => {
  expect(Object.keys(config).sort()).toEqual(
    [
      'api_base',
      'license_issuer',
      'license_key_id',
      'license_public_jwk',
      'project_ref',
      'supabase_publishable_key',
      'supabase_url',
    ].sort(),
  );
  expect(config.supabase_url).toBe(`https://${config.project_ref}.supabase.co`);
  expect(config.api_base).toBe(`${config.supabase_url}/functions/v1/api`);
  expect(config.license_issuer).toBe(config.supabase_url);
  expect(config.license_public_jwk).not.toHaveProperty('d');
  expect(config.license_public_jwk.kty).toBe('EC');
  expect(config.supabase_publishable_key).toMatch(/^sb_publishable_/);
});
it('records the exact secret-free standalone Edge artifact digest', () => {
  const bundle = readFileSync('deployment/edge/runtime.js');
  const integrity = JSON.parse(readFileSync('deployment/edge/integrity.json', 'utf8'));
  expect(createHash('sha256').update(bundle).digest('hex')).toBe(integrity.sha256);
  expect(bundle.length).toBe(integrity.bytes);
  expect(bundle.toString()).not.toMatch(/from ["'](?:\.\.|https?:|npm:)/);
});
