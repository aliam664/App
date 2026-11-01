import { beforeEach, describe, it, expect } from 'vitest';
import { exportJWK, generateKeyPair } from 'jose';
import { createApi, type ApiConfig } from '../backend/src/api';
import { LocalRepository, emptyState } from '../backend/dev/store';
import { b64, codeHash, verifyToken, grant } from '../backend/src/crypto';
import { seedPackages } from '../backend/src/seed';
let repo: LocalRepository, config: ApiConfig, handler: ReturnType<typeof createApi>;
const code = 'UHM-EXAMPLE-LONG-TEST-CODE-123456';
const pub = (key: JsonWebKey) => ({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
async function request(path: string, body?: unknown, token?: string, origin?: string) {
  const response = await handler(
    new Request(`https://api.example.com/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    'test-client',
  );
  return { status: response.status, data: await response.json() };
}
async function device() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const public_key = pub(await crypto.subtle.exportKey('jwk', keys.publicKey));
  return { keys, public_key };
}
async function proof(d: Awaited<ReturnType<typeof device>>, purpose: string) {
  const { data: c } = await request('/device/challenge', { public_key: d.public_key, purpose });
  return {
    public_key: d.public_key,
    challenge_id: c.id,
    signature: b64(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          d.keys.privateKey,
          new TextEncoder().encode(`UHM:device-proof:v1:${c.nonce}`),
        ),
      ),
    ),
  };
}
beforeEach(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  config = {
    mode: 'production',
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
    pepper: 'test-pepper-32-characters-minimum',
    issuer: 'https://api.example.com',
    kid: 'test-v1',
    allowedOrigins: ['https://admin.example.com'],
  };
  const state = emptyState();
  state.packages = seedPackages();
  state.licenses = [
    {
      id: crypto.randomUUID(),
      code_hash: await codeHash(code, config.pepper),
      prefix: 'UHM-EXAMP',
      tier: 'pro',
      status: 'unused',
      duration_days: 30,
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: null,
      device_thumbprint: null,
      entitlement_version: 1,
      activation_count: 0,
    },
  ];
  repo = new LocalRepository(state);
  handler = createApi(repo, config);
});
describe('API authorization', () => {
  it('does not expose demo credentials in production', async () =>
    expect((await request('/demo/session', {})).status).toBe(404));
  it('requires admin authentication', async () =>
    expect((await request('/admin/overview')).status).toBe(401));
  it('does not expose code hashes even to admins', async () => {
    const r = await request('/admin/overview', undefined, repo.adminToken);
    expect(r.status).toBe(200);
    expect(r.data.licenses[0]).not.toHaveProperty('code_hash');
  });
  it('strips download URLs from catalog', async () => {
    const r = await request('/catalog');
    expect(r.status).toBe(200);
    expect(r.data.packages[0]).not.toHaveProperty('files');
  });
  it('rejects unapproved origins', async () =>
    expect((await request('/catalog', undefined, undefined, 'https://evil.example')).status).toBe(
      403,
    ));
  it('validates batch limits', async () =>
    expect(
      (
        await request(
          '/admin/licenses',
          { tier: 'vip', count: 101, duration_days: 30 },
          repo.adminToken,
        )
      ).status,
    ).toBe(400));
  it('returns plaintext only once and stores keyed hashes', async () => {
    const r = await request(
      '/admin/licenses',
      { tier: 'normal', count: 2, duration_days: 30 },
      repo.adminToken,
    );
    expect(r.status).toBe(201);
    expect(r.data.codes).toHaveLength(2);
    expect(JSON.stringify(repo.state)).not.toContain(r.data.codes[0]);
    expect(repo.state.licenses).toHaveLength(3);
  });
  it('requires MFA on mutations', async () => {
    repo.admin = async () => ({ id: 'viewer', role: 'owner', aal: 'aal1' });
    expect(
      (await request('/admin/licenses', { tier: 'normal', count: 1, duration_days: 30 }, 'token'))
        .status,
    ).toBe(403);
  });
  it('denies viewer writes', async () => {
    repo.admin = async () => ({ id: 'viewer', role: 'viewer', aal: 'aal2' });
    expect(
      (await request('/admin/licenses', { tier: 'normal', count: 1, duration_days: 30 }, 'token'))
        .status,
    ).toBe(403);
  });
});
describe('device protocol and license state', () => {
  it('activates with real P-256 proof and issues verifiable grant', async () => {
    const d = await device();
    const r = await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    expect(r.status).toBe(200);
    const claims = await verifyToken(r.data.grant, config, 'uhm-offline+jwt');
    expect(claims.tier).toBe('pro');
    expect(claims.offline_until).toBeLessThanOrEqual(Date.now() + 10 * 86400000);
    expect(repo.state.licenses[0].activation_count).toBe(1);
  });
  it('rejects replayed challenges', async () => {
    const d = await device(),
      p = await proof(d, 'activate');
    expect((await request('/licenses/activate', { code, ...p })).status).toBe(200);
    expect((await request('/licenses/activate', { code, ...p })).status).toBe(401);
  });
  it('does not accept proof for another operation', async () => {
    const d = await device();
    expect(
      (await request('/licenses/activate', { code, ...(await proof(d, 'refresh')) })).status,
    ).toBe(401);
  });
  it('accepts retry by same device without additional activation', async () => {
    const d = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    expect(repo.state.licenses[0].activation_count).toBe(1);
  });
  it('has exactly one winner for two concurrent devices', async () => {
    const a = await device(),
      b = await device();
    const pa = await proof(a, 'activate'),
      pb = await proof(b, 'activate');
    const result = await Promise.all([
      request('/licenses/activate', { code, ...pa }),
      request('/licenses/activate', { code, ...pb }),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(repo.state.licenses[0].activation_count).toBe(1);
  });
  it('rejects altered proof', async () => {
    const d = await device(),
      p = await proof(d, 'activate');
    p.signature = p.signature.slice(0, -4) + 'AAAA';
    expect((await request('/licenses/activate', { code, ...p })).status).toBe(401);
  });
  it('rejects suspended licenses on refresh', async () => {
    const d = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    await repo.mutateLicense(repo.state.licenses[0].id, 'suspend', 'owner');
    expect((await request('/licenses/refresh', await proof(d, 'refresh'))).status).toBe(403);
  });
  it('cannot resurrect a revoked license through suspension', async () => {
    const id = repo.state.licenses[0].id;
    await repo.mutateLicense(id, 'revoke', 'owner');
    await expect(repo.mutateLicense(id, 'suspend', 'owner')).rejects.toThrow('INVALID_ACTION');
  });
  it('preserves subscription end on admin device reset', async () => {
    const d = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    const end = repo.state.licenses[0].expires_at;
    await repo.mutateLicense(repo.state.licenses[0].id, 'reset', 'owner');
    expect(repo.state.licenses[0].expires_at).toBe(end);
    expect(repo.state.licenses[0].device_thumbprint).toBeNull();
  });
  it('grant verification rejects token type confusion', async () => {
    const l = repo.state.licenses[0];
    l.expires_at = new Date(Date.now() + 86400000).toISOString();
    const token = await grant(l, config);
    await expect(verifyToken(token, config, 'uhm-plan+jwt')).rejects.toThrow();
  });
  it('never treats a no-file sample as a real install plan', async () => {
    const d = await device();
    const r = await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    const plan = await request(
      '/install/plan',
      { package_id: repo.state.packages[2].id, ...(await proof(d, 'plan')) },
      r.data.grant,
    );
    expect(plan.status).toBe(409);
    expect(plan.data.error).toBe('DEMO_FILES_NOT_CONFIGURED');
  });
  it('enforces subscription before creating a plan', async () => {
    const d = await device();
    const r = await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    const plan = await request(
      '/install/plan',
      { package_id: repo.state.packages[1].id, ...(await proof(d, 'plan')) },
      r.data.grant,
    );
    expect(plan.status).toBe(409);
    expect(plan.data.error).toBe('TIER_REQUIRED');
  });
  it('consumes challenge atomically', async () => {
    const d = await device();
    const p = await proof(d, 'refresh');
    const c = repo.state.challenges.find((c) => c.id === p.challenge_id)!;
    const results = await Promise.all([
      repo.consumeChallenge(c.id, c.thumbprint, new Date().toISOString()),
      repo.consumeChallenge(c.id, c.thumbprint, new Date().toISOString()),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });
});

describe('immutable content publishing', () => {
  async function publishFixture() {
    const pkg = {
      ...seedPackages()[2],
      id: crypto.randomUUID(),
      slug: 'fixture-pack',
      status: 'draft' as const,
      version: '1.0.0',
      dependencies: [],
      files: [
        {
          id: crypto.randomUUID(),
          name: 'settings.ini',
          url: 'https://downloads.example.com/settings.ini',
          size: 12,
          sha256: 'a'.repeat(64),
          format: 'file' as const,
        },
      ],
      steps: [] as any[],
      released_at: null,
    };
    pkg.steps = [
      {
        id: crypto.randomUUID(),
        file_id: pkg.files[0].id,
        action: 'copy',
        destination: 'extension/config/settings.ini',
        overwrite: 'backup',
      },
    ];
    expect((await request('/admin/packages', pkg, repo.adminToken)).status).toBe(200);
    expect((await request(`/admin/packages/${pkg.id}/publish`, {}, repo.adminToken)).status).toBe(
      200,
    );
    return pkg;
  }
  it('persists release snapshots and keeps live catalog while next version is drafted', async () => {
    const pkg = await publishFixture();
    const releases = await request('/admin/releases', undefined, repo.adminToken);
    expect(releases.data.releases).toHaveLength(1);
    expect(
      (await request('/admin/packages', { ...pkg, version: '1.1.0' }, repo.adminToken)).status,
    ).toBe(200);
    const live = (await request('/catalog')).data.packages.find((p: any) => p.id === pkg.id);
    expect(live.version).toBe('1.0.0');
    expect((await request(`/admin/packages/${pkg.id}/publish`, {}, repo.adminToken)).status).toBe(
      200,
    );
    expect(
      (await request('/catalog')).data.packages.find((p: any) => p.id === pkg.id).version,
    ).toBe('1.1.0');
  });
  it('creates a verifiable installation plan from a real release', async () => {
    const pkg = await publishFixture();
    const d = await device();
    const active = await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    const r = await request(
      '/install/plan',
      { package_id: pkg.id, ...(await proof(d, 'plan')) },
      active.data.grant,
    );
    expect(r.status).toBe(200);
    const claims = await verifyToken(r.data.plan, config, 'uhm-plan+jwt');
    expect((claims.packages as any[])[0].files[0].sha256).toBe('a'.repeat(64));
  });
  it('archives content instead of exposing historical versions again', async () => {
    const pkg = await publishFixture();
    await request(`/admin/packages/${pkg.id}/archive`, {}, repo.adminToken);
    expect((await request('/catalog')).data.packages.some((p: any) => p.id === pkg.id)).toBe(false);
  });
});
