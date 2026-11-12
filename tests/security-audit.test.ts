/** Read-only production audit is separate. All mutations below use disposable local fixtures.
 * Previous findings below are ordinary regression tests; none are skipped.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair } from 'jose';
import { createApi, type ApiConfig } from '../backend/src/api';
import { LocalRepository, emptyState } from '../backend/dev/store';
import { b64, codeHash, signPayload, verifyToken } from '../backend/src/crypto';
import { DownloadUrl, PackageSpec, type Role } from '../packages/contracts/src/index';
let repo: LocalRepository, config: ApiConfig, handler: ReturnType<typeof createApi>;
const code = 'UHM-LOCAL-SECURITY-AUDIT-ONLY';
function pkg(): PackageSpec {
  const file = crypto.randomUUID();
  return PackageSpec.parse({
    id: crypto.randomUUID(),
    slug: 'audit-' + crypto.randomUUID(),
    name: 'Audit fixture',
    description: 'Local security audit fixture, never a production package',
    category: 'cars',
    tier: 'normal',
    image: '/images/01.jpg',
    version: '1.0.0',
    changelog: '',
    dependencies: [],
    files: [
      {
        id: file,
        name: 'fixture.zip',
        url: 'https://files.example.com/fixture.zip',
        sha256: 'a'.repeat(64),
        size: 100,
        format: 'zip',
        archive_password: 'local-fixture-only',
      },
    ],
    steps: [
      {
        id: crypto.randomUUID(),
        file_id: file,
        action: 'extract',
        destination: 'content/cars',
        overwrite: 'backup',
      },
    ],
    status: 'draft',
    released_at: null,
  });
}
async function request(path: string, body?: unknown, token = repo.adminToken) {
  const r = await handler(
    new Request('https://audit.invalid/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    'unknown',
  );
  return { status: r.status, data: await r.json() };
}
async function activate() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const public_key = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
  async function proof(purpose: string) {
    const { data: c } = await request('/device/challenge', { public_key, purpose }, '');
    return {
      public_key,
      challenge_id: c.id,
      signature: b64(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            pair.privateKey,
            new TextEncoder().encode(`UHM:device-proof:v1:${c.nonce}`),
          ),
        ),
      ),
    };
  }
  const { data, status } = await request(
    '/licenses/activate',
    { code, ...(await proof('activate')) },
    '',
  );
  expect(status).toBe(200);
  return { grant: data.grant as string, proof };
}
beforeEach(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  config = {
    mode: 'production',
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
    pepper: 'local-audit-pepper-not-a-production-secret',
    issuer: 'https://audit.invalid',
    kid: 'audit',
    allowedOrigins: [],
  };
  repo = new LocalRepository(emptyState());
  repo.state.licenses = [
    {
      id: crypto.randomUUID(),
      code_hash: await codeHash(code, config.pepper),
      prefix: 'AUDIT',
      tier: 'vip',
      duration_days: 30,
      status: 'unused',
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: null,
      device_thumbprint: null,
      entitlement_version: 1,
      activation_count: 0,
    },
  ];
  handler = createApi(repo, config);
});
describe('role and package API authorization matrix', () => {
  for (const role of [
    'owner',
    'content_manager',
    'license_manager',
    'support',
    'viewer',
  ] as Role[]) {
    const allowed = ['owner', 'content_manager'].includes(role);
    for (const action of ['save', 'validate', 'publish', 'archive', 'test-plan']) {
      it(`${role}: ${action} ${allowed ? 'permitted at permission boundary' : 'denied'}`, async () => {
        repo.admin = async () => ({ id: 'local-staff', role, aal: 'aal2' });
        const p = pkg();
        await repo.insert('packages', [p]);
        const result =
          action === 'save'
            ? await request('/admin/packages', pkg())
            : await request(`/admin/packages/${p.id}/${action}`, {});
        // Authorized test-plan still needs the independently validated device proof and grant.
        expect(result.status).toBe(!allowed ? 403 : action === 'test-plan' ? 400 : 200);
        if (!allowed) expect(repo.state.packages).toEqual([p]);
      });
    }
  }
  it('a custom editor cannot publish merely by having content.write', async () => {
    repo.admin = async () => ({
      id: 'editor',
      role: 'viewer',
      permissions: ['content.read', 'content.write'],
      aal: 'aal2',
    });
    const p = pkg();
    expect((await request('/admin/packages', p)).status).toBe(200);
    expect((await request(`/admin/packages/${p.id}/publish`, {})).status).toBe(403);
  });
  it('a custom publisher can publish but cannot replace links or archive passwords', async () => {
    repo.admin = async () => ({
      id: 'publisher',
      role: 'viewer',
      permissions: ['content.read', 'content.publish'],
      aal: 'aal2',
    });
    const p = pkg();
    await repo.insert('packages', [p]);
    const overview = await request('/admin/overview');
    expect(overview.data.packages[0].files).toEqual([]);
    expect(JSON.stringify(overview.data)).not.toContain('local-fixture-only');
    expect((await request('/admin/packages', { ...p, name: 'Changed' })).status).toBe(403);
    expect((await request(`/admin/packages/${p.id}/publish`, {})).status).toBe(200);
  });
  it('an editor cannot promote themselves to owner without team.manage', async () => {
    repo.admin = async () => ({ id: 'editor', role: 'content_manager', aal: 'aal2' });
    expect(
      (
        await request(`/admin/team/${repo.state.licenses[0].id}`, {
          role: 'owner',
          permissions: [],
          enabled: true,
        })
      ).status,
    ).toBe(403);
  });
  it('anonymous catalog excludes links, steps and archive passwords', async () => {
    const p = { ...pkg(), status: 'published' as const };
    repo.state.packages.push(p);
    const result = await request('/catalog', undefined, '');
    expect(result.status).toBe(200);
    expect(result.data.packages[0]).not.toHaveProperty('files');
    expect(result.data.packages[0]).not.toHaveProperty('steps');
    expect(JSON.stringify(result.data)).not.toContain('local-fixture-only');
  });
});
describe('cryptographic boundary and independent live permissions', () => {
  it('changing owner role claims in a valid admin token cannot override database permissions', async () => {
    const d = await activate(),
      license = repo.state.licenses[0];
    repo.state.admin_access = [
      {
        id: license.id,
        role: 'viewer',
        permissions: ['content.read'],
        enabled: true,
        version: 1,
        updated_at: new Date().toISOString(),
      },
    ];
    const token = await signPayload(
      {
        license_id: license.id,
        device_thumbprint: license.device_thumbprint,
        access_version: 1,
        entitlement_version: 1,
        role: 'owner',
        permissions: ['content.write', 'content.publish'],
      },
      config,
      'uhm-admin+jwt',
      900,
    );
    const payload = await verifyToken(d.grant, config, 'uhm-offline+jwt');
    expect(payload.tier).toBe('vip');
    expect((await request('/admin/packages', pkg(), token)).status).toBe(403);
    repo.state.admin_access[0].enabled = false;
    expect((await request('/admin/overview', undefined, token)).status).toBe(401);
  });
  it('cannot use an offline grant as an admin session or a forged signature as authorization', async () => {
    const d = await activate();
    expect((await request('/admin/overview', undefined, d.grant)).status).toBe(401);
    const pieces = d.grant.split('.');
    pieces[1] = Buffer.from(JSON.stringify({ tier: 'vip', role: 'owner' })).toString('base64url');
    expect((await request('/admin/overview', undefined, pieces.join('.'))).status).toBe(401);
  });
  it('refuses an install plan when the subscription is revoked even if the grant is unexpired', async () => {
    const d = await activate(),
      p = { ...pkg(), status: 'published' as const };
    repo.state.packages.push(p);
    await repo.mutateLicense(repo.state.licenses[0].id, 'revoke', 'local-audit');
    expect(
      (await request('/install/plan', { package_id: p.id, ...(await d.proof('plan')) }, d.grant))
        .status,
    ).toBe(403);
  });
});
describe('regressions for the four previously open findings', () => {
  it("AUD-01: an anonymous flood must not exhaust another user's production unknown-IP bucket", async () => {
    for (let i = 0; i < 120; i++)
      expect((await request('/catalog', undefined, '')).status).toBe(200);
    // The 121st anonymous public read from the same bucket is throttled cleanly...
    expect((await request('/catalog', undefined, '')).status).toBe(429);
    // ...without starving admin endpoints or licensed device challenge/activation/plan operations!
    expect((await request('/admin/overview')).status).toBe(200);
    const d = await activate();
    const p = { ...pkg(), status: 'published' as const };
    repo.state.packages.push(p);
    expect(
      (await request('/install/plan', { package_id: p.id, ...(await d.proof('plan')) }, d.grant))
        .status,
    ).toBe(200);
  });
  it('AUD-04: a dependency plan exceeding the native 30-package limit should fail before signing', async () => {
    const chain = Array.from({ length: 31 }, () => ({ ...pkg(), status: 'published' as const }));
    for (let i = 0; i < chain.length - 1; i++) chain[i].dependencies = [chain[i + 1].id];
    repo.state.packages.push(...chain);
    const d = await activate();
    const result = await request(
      '/install/plan',
      { package_id: chain[0].id, ...(await d.proof('plan')) },
      d.grant,
    );
    if (result.status === 200)
      expect((await verifyToken(result.data.plan, config, 'uhm-plan+jwt')).packages).toHaveLength(
        31,
      );
    expect(result.status).toBe(409); // current actual: signed 200; desktop rejects later
  });
  it('AUD-05: publication should reject a package exceeding the native 100GB combined artifact limit', async () => {
    const p = pkg();
    p.files[0].size = 60_000_000_000;
    p.files.push({ ...p.files[0], id: crypto.randomUUID(), name: 'second.zip' });
    p.steps.push({
      ...p.steps[0],
      id: crypto.randomUUID(),
      file_id: p.files[1].id,
      destination: 'content/tracks',
    });
    await repo.insert('packages', [p]);
    expect((await request(`/admin/packages/${p.id}/publish`, {})).status).toBe(409); // actual: 200
  });
  it('AUD-06: benchmarking-only IPv4 and trailing-dot local hostnames are rejected', () => {
    expect(DownloadUrl.safeParse('https://198.18.0.1/file.zip').success).toBe(false);
    expect(DownloadUrl.safeParse('https://localhost./file.zip').success).toBe(false);
    expect(DownloadUrl.safeParse('https://127.0.0.1./file.zip').success).toBe(false);
    expect(DownloadUrl.safeParse('https://100.64.0.1/file.zip').success).toBe(false);
  });
});

describe('Contact Us configuration security, permissions, CAS and audit trail', () => {
  it('starts empty by default, rejects unsafe URLs, enforces contact.manage & CAS, and hides updated_by publicly', async () => {
    const initial = await request('/contact', undefined, '');
    expect(initial.status).toBe(200);
    expect(initial.data.configured).toBe(false);
    expect(initial.data.contact.email).toBe('');
    expect(initial.data.contact.phone).toBe('');
    expect(initial.data.contact).not.toHaveProperty('updated_by');

    // Non-contact-admin staff cannot read or mutate /admin/contact
    repo.admin = async () => ({
      id: 'svc-only',
      role: 'viewer',
      permissions: ['service.manage'],
      aal: 'aal2',
    });
    expect((await request('/admin/contact', undefined)).status).toBe(403);
    expect(
      (
        await request('/admin/contact', {
          email: 'team@example.com',
          expected_version: 0,
        })
      ).status,
    ).toBe(403);

    // Owner or contact.manage delegate can save with CAS
    repo.admin = async () => ({ id: 'owner-1', role: 'owner', aal: 'aal2' });
    expect(
      (
        await request('/admin/contact', {
          website: 'javascript:alert(1)',
          expected_version: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('/admin/contact', {
          telegram: 'https://evil.invalid/phish',
          expected_version: 0,
        })
      ).status,
    ).toBe(400);

    const saved = await request('/admin/contact', {
      headline_fa: 'پشتیبانی فنی',
      headline_en: 'Technical Desk',
      email: 'support@example.com',
      telegram: '@ac_atelier',
      discord: 'https://discord.gg/example-team',
      extra_links: [
        { label_fa: 'مستندات نصب', label_en: 'Install Docs', url: 'https://docs.example.com' },
      ],
      expected_version: 0,
    });
    expect(saved.status).toBe(200);
    expect(saved.data.configured).toBe(true);
    expect(saved.data.contact.version).toBe(1);
    expect(saved.data.audit[0].action).toBe('contact.settings.changed');

    // Stale expected_version returns 409 EDIT_CONFLICT
    const conflict = await request('/admin/contact', {
      email: 'stale@example.com',
      expected_version: 0,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.data.error).toBe('EDIT_CONFLICT');

    // Public response returns configured channels without internal updated_by
    const pub = await request('/contact', undefined, '');
    expect(pub.status).toBe(200);
    expect(pub.data.configured).toBe(true);
    expect(pub.data.contact.email).toBe('support@example.com');
    expect(pub.data.contact).not.toHaveProperty('updated_by');
  });
});
