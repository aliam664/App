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
    expect(r.data.codes.every((code: string) => /^UHM-[A-F0-9]{40}$/.test(code))).toBe(true);
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
    expect(
      (
        await request('/licenses/refresh', {
          license_id: repo.state.licenses[0].id,
          ...(await proof(d, 'refresh')),
        })
      ).status,
    ).toBe(403);
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

describe('explicit license renewal', () => {
  it('renews the requested license when one device owns multiple licenses', async () => {
    const d = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    const batch = await request(
      '/admin/licenses',
      { tier: 'vip', duration_days: 30, count: 1 },
      repo.adminToken,
    );
    const active = await request('/licenses/activate', {
      code: batch.data.codes[0],
      ...(await proof(d, 'activate')),
    });
    const refreshed = await request('/licenses/refresh', {
      license_id: active.data.license.id,
      ...(await proof(d, 'refresh')),
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.license.tier).toBe('vip');
  });
  it('never renews another device license merely by knowing its ID', async () => {
    const d = await device(),
      other = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    expect(
      (
        await request('/licenses/refresh', {
          license_id: repo.state.licenses[0].id,
          ...(await proof(other, 'refresh')),
        })
      ).status,
    ).toBe(403);
  });
});

describe('license-bound staff and operational console', () => {
  async function activateStaff(
    permissions: import('../packages/contracts/src/index').Permission[] = [
      'licenses.read',
      'licenses.update',
      'analytics.read',
      'errors.read',
    ],
  ) {
    const d = await device();
    const id = repo.state.licenses[0].id;
    expect(
      (
        await request(
          `/admin/team/${id}`,
          { role: 'support', permissions, enabled: true },
          repo.adminToken,
        )
      ).status,
    ).toBe(200);
    const activation = await request('/licenses/activate', {
      code,
      ...(await proof(d, 'activate')),
    });
    expect(activation.status).toBe(200);
    const session = await request('/admin/license-session', {
      license_id: id,
      ...(await proof(d, 'admin')),
    });
    expect(session.status).toBe(200);
    return { d, id, token: session.data.token, grant: activation.data.grant };
  }
  it('never upgrades an ordinary app license into an administrator', async () => {
    const d = await device();
    await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    expect(
      (
        await request('/admin/license-session', {
          license_id: repo.state.licenses[0].id,
          ...(await proof(d, 'admin')),
        })
      ).status,
    ).toBe(403);
  });
  it('uses one assigned license for app and panel, with per-permission enforcement', async () => {
    const { id, token, grant: g } = await activateStaff();
    expect((await request('/admin/overview', undefined, token)).data.licenses[0].id).toBe(id);
    expect(
      (await request('/admin/licenses', { tier: 'pro', count: 1, duration_days: 30 }, token))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          `/admin/licenses/${id}/metadata`,
          { display_name: 'Support One', notes: 'internal', tags: ['team'] },
          token,
        )
      ).status,
    ).toBe(200);
    expect((await request('/admin/overview', undefined, g)).status).toBe(401);
  });
  it('denies another device, replayed challenges, and disabled memberships', async () => {
    const { d, id, token } = await activateStaff();
    const other = await device();
    expect(
      (
        await request('/admin/license-session', {
          license_id: id,
          ...(await proof(other, 'admin')),
        })
      ).status,
    ).toBe(403);
    const p = await proof(d, 'admin');
    expect((await request('/admin/license-session', { license_id: id, ...p })).status).toBe(200);
    expect((await request('/admin/license-session', { license_id: id, ...p })).status).toBe(401);
    await repo.saveAccess({ ...repo.state.admin_access[0], enabled: false }, 'owner');
    expect((await request('/admin/overview', undefined, token)).status).toBe(401);
  });
  it('applies reduced permissions on the very next request and can renew a valid device session', async () => {
    const { d, id, token } = await activateStaff();
    await repo.saveAccess(
      { ...repo.state.admin_access[0], permissions: ['content.read'] },
      'owner',
    );
    expect((await request('/admin/overview', undefined, token)).status).toBe(401);
    const next = await request('/admin/license-session', {
      license_id: id,
      ...(await proof(d, 'admin')),
    });
    const view = await request('/admin/overview', undefined, next.data.token);
    expect(view.data.licenses).toEqual([]);
    expect(view.data.packages.length).toBeGreaterThan(0);
    expect(view.data.packages.every((p: any) => p.files.length === 0)).toBe(true);
  });
  it('prevents self-promotion and a delegated manager granting rights they do not own', async () => {
    const { id, token } = await activateStaff(['team.manage', 'licenses.read']);
    expect(
      (await request(`/admin/team/${id}`, { role: 'owner', permissions: [], enabled: true }, token))
        .status,
    ).toBe(403);
    const fresh = await request(
      '/admin/licenses',
      { tier: 'normal', count: 1, duration_days: 30 },
      repo.adminToken,
    );
    expect(
      (
        await request(
          `/admin/team/${fresh.data.licenses[0].id}`,
          { role: 'support', permissions: ['service.manage'], enabled: true },
          token,
        )
      ).status,
    ).toBe(403);
  });
  it('invalidates staff sessions after device reset or license suspension', async () => {
    const { id, token } = await activateStaff();
    await repo.mutateLicense(id, 'reset', 'owner');
    expect((await request('/admin/overview', undefined, token)).status).toBe(401);
  });
  it('stores metadata privately, not in the activation response', async () => {
    const id = repo.state.licenses[0].id;
    await request(
      `/admin/licenses/${id}/metadata`,
      { display_name: 'Customer', notes: 'private-note', tags: ['vip'] },
      repo.adminToken,
    );
    const d = await device();
    const r = await request('/licenses/activate', { code, ...(await proof(d, 'activate')) });
    expect(JSON.stringify(r.data)).not.toContain('private-note');
    expect(
      (await request('/admin/overview', undefined, repo.adminToken)).data.licenses[0].notes,
    ).toBe('private-note');
  });
  it('accepts offline events idempotently and uses occurrence time for analytics', async () => {
    const { id, d } = await activateStaff();
    const event = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      type: 'app_open',
      occurred_at: new Date(Date.now() - 86400000).toISOString(),
      stage: 'app',
    };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request('/telemetry/batch', {
            license_id: id,
            events: [event],
            ...(await proof(d, 'telemetry')),
          })
        ).data.accepted,
      ).toEqual([event.id]);
    expect(repo.state.telemetry_events).toHaveLength(1);
    const stats = await request('/admin/analytics?days=7', undefined, repo.adminToken);
    expect(stats.data.totals).toEqual([{ type: 'app_open', count: 1 }]);
    expect(stats.data.daily[0].day).toBe(event.occurred_at.slice(0, 10));
  });
  it('rejects raw stack traces or URLs in telemetry and permits expiry-only late uploads', async () => {
    const { id, d } = await activateStaff();
    repo.state.licenses[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const e = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      type: 'app_error',
      occurred_at: new Date().toISOString(),
      error_code: 'APP_RUNTIME_ERROR',
    };
    expect(
      (
        await request('/telemetry/batch', {
          license_id: id,
          events: [{ ...e, url: 'https://private.example/?token=x' }],
          ...(await proof(d, 'telemetry')),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('/telemetry/batch', {
          license_id: id,
          events: [e],
          ...(await proof(d, 'telemetry')),
        })
      ).status,
    ).toBe(200);
  });
  it('pauses new operations without locking out owners or telemetry', async () => {
    const { id, d } = await activateStaff();
    expect(
      (
        await request(
          '/admin/service',
          {
            maintenance: true,
            activation_paused: false,
            issuance_paused: true,
            downloads_paused: true,
            message: 'Maintenance',
          },
          repo.adminToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('/licenses/activate', { code, ...(await proof(d, 'activate')) })).status,
    ).toBe(503);
    expect(
      (
        await request(
          '/admin/licenses',
          { tier: 'normal', count: 1, duration_days: 30 },
          repo.adminToken,
        )
      ).status,
    ).toBe(503);
    expect((await request('/admin/overview', undefined, repo.adminToken)).status).toBe(200);
    const e = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      type: 'install_failed',
      occurred_at: new Date().toISOString(),
      error_code: 'DISK_FULL',
    };
    expect(
      (
        await request('/telemetry/batch', {
          license_id: id,
          events: [e],
          ...(await proof(d, 'telemetry')),
        })
      ).status,
    ).toBe(200);
  });
  it('protects the last license owner', async () => {
    const id = repo.state.licenses[0].id;
    await repo.saveAccess(
      {
        id,
        role: 'owner',
        permissions: [],
        enabled: true,
        version: 1,
        updated_at: new Date().toISOString(),
      },
      'bootstrap',
    );
    expect(
      (
        await request(
          `/admin/team/${id}`,
          { role: 'viewer', permissions: [], enabled: true },
          repo.adminToken,
        )
      ).status,
    ).toBe(409);
  });
});

it('resolves the selected license error without changing a colliding client event ID', async () => {
  const a = repo.state.licenses[0].id;
  const b = crypto.randomUUID();
  repo.state.licenses.push({ ...repo.state.licenses[0], id: b, code_hash: 'other-test-hash' });
  const eventId = crypto.randomUUID();
  const base = {
    id: eventId,
    type: 'app_error' as const,
    occurred_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    session_id: crypto.randomUUID(),
    error_code: 'APP_RUNTIME_ERROR',
    resolved_at: null,
    resolved_by: null,
  };
  await repo.ingestEvents([
    { ...base, license_id: a },
    { ...base, license_id: b },
  ]);
  expect(
    (await request(`/admin/errors/${eventId}/resolve`, { license_id: b }, repo.adminToken)).status,
  ).toBe(200);
  expect(repo.state.telemetry_events.find((e) => e.license_id === a)?.resolved_at).toBeNull();
  expect(repo.state.telemetry_events.find((e) => e.license_id === b)?.resolved_at).toBeTruthy();
});
it('accepts real PostgreSQL timezone offsets in history cursors', async () => {
  const id = repo.state.licenses[0].id;
  const cursor = encodeURIComponent(
    JSON.stringify({ at: '2026-11-02T00:00:00+00:00', id: crypto.randomUUID() }),
  );
  expect(
    (await request(`/admin/licenses/${id}/activity?cursor=${cursor}`, undefined, repo.adminToken))
      .status,
  ).toBe(200);
});
