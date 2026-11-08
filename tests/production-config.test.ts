import { expect, it, vi, afterEach } from 'vitest';
import { SupabaseRepository } from '../backend/src/supabase-repository';
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
it('pins the exact body-only cloud entry without relative or HTTPS module imports', () => {
  const body = readFileSync('deployment/edge/api.js');
  const record = JSON.parse(readFileSync('deployment/edge/cloud-integrity.json', 'utf8'));
  expect(createHash('sha256').update(body).digest('hex')).toBe(record.api.sha256);
  expect(body.length).toBe(record.api.bytes);
  expect(body.toString()).not.toMatch(/from["'](?:\.\.|https?:)/);
  for (const specifier of Object.values(record.npm)) expect(body.toString()).toContain(specifier);
});

it('pins the standalone update broker artifact as well as the API', () => {
  const body = readFileSync('deployment/edge/update-key-broker.js');
  const record = JSON.parse(readFileSync('deployment/edge/cloud-integrity.json', 'utf8'));
  expect(createHash('sha256').update(body).digest('hex')).toBe(record.updateKeyBroker.sha256);
  expect(body.length).toBe(record.updateKeyBroker.bytes);
  expect(body.toString()).not.toMatch(/from["'](?:\.\.|https?:)/);
});
afterEach(() => vi.unstubAllGlobals());
it('release history paginates past 500 using only real release-table columns', async () => {
  const ranges: string[] = [];
  const orders: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      ranges.push(`${url.searchParams.get('offset')}:${url.searchParams.get('limit')}`);
      orders.push(url.searchParams.get('order') || '');
      const offset = Number(url.searchParams.get('offset'));
      const rows = Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({
        package_id: null,
        version: `1.0.${offset + i}`,
        manifest: {},
        published_at: '2026-11-08T00:00:00Z',
      }));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Range': `${offset}-${offset + rows.length - 1}/*`,
        },
      });
    }),
  );
  const repo = new SupabaseRepository('https://pagination.invalid', 'test-only-not-a-secret');
  const rows = await repo.releases();
  expect(rows).toHaveLength(501);
  expect(ranges).toEqual(['0:500', '500:500']);
  expect(orders[0]).toBe('published_at.desc,package_id.desc,version.desc');
});
