import { beforeEach, expect, it } from 'vitest';
import { exportJWK, generateKeyPair } from 'jose';
import { createApi, type ApiConfig } from '../backend/src/api';
import { LocalRepository, emptyState } from '../backend/dev/store';
import { signPayload } from '../backend/src/crypto';
import { accessPermissions, type Permission } from '../packages/contracts/src/index';
let repo: LocalRepository, config: ApiConfig, api: ReturnType<typeof createApi>;
async function request(path: string, body?: unknown, token = repo.adminToken) {
  const r = await api(
    new Request(`https://roles.invalid/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, data: await r.json() };
}
async function role(permissions: Permission[], name = 'نقش آزمایشی') {
  const id = crypto.randomUUID();
  expect(
    (
      await request(`/admin/roles/${id}`, {
        name,
        description: 'فقط محیط ایزوله',
        enabled: true,
        permissions,
        expected_version: 0,
      })
    ).status,
  ).toBe(200);
  return repo.state.custom_roles.find((r) => r.id === id)!;
}
async function staff(roleIds: string[], permissions: Permission[] = []) {
  const id = crypto.randomUUID();
  repo.state.licenses.push({
    id,
    prefix: 'TEST',
    code_hash: id,
    status: 'active',
    tier: 'normal',
    duration_days: 30,
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    device_thumbprint: 'test-device',
    entitlement_version: 1,
    activation_count: 1,
  });
  expect(
    (
      await request(`/admin/team/${id}`, {
        role: 'viewer',
        role_ids: roleIds,
        permissions,
        enabled: true,
        expected_version: 0,
      })
    ).status,
  ).toBe(200);
  const token = await signPayload(
    { license_id: id, device_thumbprint: 'test-device', access_version: 1, entitlement_version: 1 },
    config,
    'uhm-admin+jwt',
    900,
  );
  return { id, token };
}
beforeEach(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  config = {
    mode: 'production',
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
    pepper: 'isolated-test-pepper',
    kid: 'test',
    issuer: 'https://roles.invalid',
    allowedOrigins: [],
  };
  repo = new LocalRepository(emptyState());
  api = createApi(repo, config);
});
it('unions several reusable roles with direct grants, never the unused template defaults', async () => {
  const r1 = await role(['licenses.read'], 'مشاهده لایسنس');
  const r2 = await role(['errors.read'], 'مشاهده خطا');
  const user = await staff([r1.id, r2.id], ['content.read']);
  const result = await request('/admin/overview', undefined, user.token);
  expect(result.status).toBe(200);
  expect(new Set(result.data.admin.permissions)).toEqual(
    new Set(['licenses.read', 'errors.read', 'content.read']),
  );
  expect((await request('/admin/analytics', undefined, user.token)).status).toBe(403);
  expect((await request('/admin/team', undefined, user.token)).status).toBe(403);
});
it('applies role revocation to an already-issued token on the very next request', async () => {
  const r = await role(['analytics.read']);
  const user = await staff([r.id]);
  expect((await request('/admin/analytics', undefined, user.token)).status).toBe(200);
  expect(
    (
      await request(`/admin/roles/${r.id}`, {
        name: r.name,
        description: '',
        permissions: ['analytics.read'],
        enabled: false,
        expected_version: 1,
      })
    ).status,
  ).toBe(200);
  expect((await request('/admin/analytics', undefined, user.token)).status).toBe(403);
});
it('prevents a delegated manager from granting stronger permissions via role IDs', async () => {
  const privileged = await role(['service.manage']);
  const manager = await staff([], ['team.manage', 'licenses.read']);
  const target = await staff([]);
  expect(
    (
      await request(
        `/admin/team/${target.id}`,
        { role: 'viewer', permissions: [], role_ids: [privileged.id], enabled: true },
        manager.token,
      )
    ).status,
  ).toBe(403);
  expect(repo.state.admin_access.find((a) => a.id === target.id)?.role_ids).toEqual([]);
});
it('does not allow delegated role authors to overwrite roles beyond their own authority', async () => {
  const privileged = await role(['service.manage']);
  const manager = await staff([], ['roles.manage', 'licenses.read']);
  expect(
    (
      await request(
        `/admin/roles/${privileged.id}`,
        {
          name: privileged.name,
          description: '',
          enabled: false,
          permissions: [],
          expected_version: 1,
        },
        manager.token,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        `/admin/roles/${crypto.randomUUID()}`,
        {
          name: 'ارتقای غیرمجاز',
          description: '',
          enabled: true,
          permissions: ['team.manage'],
          expected_version: 0,
        },
        manager.token,
      )
    ).status,
  ).toBe(403);
});
it('detects concurrent edits and records before/after changes transactionally', async () => {
  const r = await role(['licenses.read']);
  const body = {
    name: r.name,
    description: 'نسخه دوم',
    permissions: [],
    enabled: true,
    expected_version: 1,
  };
  expect((await request(`/admin/roles/${r.id}`, body)).status).toBe(200);
  expect(
    (await request(`/admin/roles/${r.id}`, { ...body, description: 'تغییر قدیمی' })).status,
  ).toBe(409);
  const events = repo.state.audit_events.filter((e) => e.target === r.id);
  expect(events).toHaveLength(2);
  expect(JSON.parse(events[1].detail).before.version).toBe(1);
  expect(JSON.parse(events[1].detail).after.version).toBe(2);
});
it('detects stale team edits and invalidates the previous access token', async () => {
  const user = await staff([], ['content.read']);
  const body = {
    role: 'viewer',
    permissions: [],
    role_ids: [],
    enabled: true,
    expected_version: 1,
  };
  expect((await request(`/admin/team/${user.id}`, body)).status).toBe(200);
  expect((await request(`/admin/team/${user.id}`, body)).status).toBe(409);
  expect((await request('/admin/overview', undefined, user.token)).status).toBe(401);
});
it('rejects disabled, duplicate and unknown role assignments', async () => {
  const r = await role([]);
  const user = await staff([]);
  const body = { role: 'viewer', permissions: [], enabled: true };
  expect(
    (await request(`/admin/team/${user.id}`, { ...body, role_ids: [r.id, r.id] })).status,
  ).toBe(400);
  expect(
    (await request(`/admin/team/${user.id}`, { ...body, role_ids: [crypto.randomUUID()] })).status,
  ).toBe(400);
  repo.state.custom_roles[0].enabled = false;
  expect((await request(`/admin/team/${user.id}`, { ...body, role_ids: [r.id] })).status).toBe(400);
});
it('does not silently resurrect built-in viewer defaults for an empty custom grant', () => {
  expect(accessPermissions({ role: 'viewer', permissions: [], role_ids: [] }, [])).toEqual([]);
});
it('rolls back role mutation and audit together if persistence fails', async () => {
  const broken = new LocalRepository(emptyState(), async () => {
    throw new Error('disk unavailable');
  });
  await expect(
    broken.saveRole(
      {
        id: crypto.randomUUID(),
        name: 'test',
        description: '',
        enabled: true,
        permissions: [],
        version: 1,
        updated_at: new Date().toISOString(),
      },
      'owner',
      0,
    ),
  ).rejects.toThrow();
  expect(broken.state.custom_roles).toEqual([]);
  expect(broken.state.audit_events).toEqual([]);
});
it('an installed 0.1.1 client editing a member does not erase reusable role assignments', async () => {
  const r = await role(['licenses.read']);
  const user = await staff([r.id]);
  expect(
    (
      await request(`/admin/team/${user.id}`, {
        role: 'viewer',
        permissions: ['errors.read'],
        enabled: true,
      })
    ).status,
  ).toBe(200);
  expect(repo.state.admin_access.find((a) => a.id === user.id)?.role_ids).toEqual([r.id]);
});
it('calendar issuance accepts fixed expiry, rejects inverted windows and never moves expiry on activation', async () => {
  const starts = new Date(Date.now() - 3600000).toISOString();
  const expires = new Date(Date.now() + 86400000).toISOString();
  const result = await request('/admin/licenses', {
    tier: 'pro',
    count: 1,
    duration_days: 30,
    starts_at: starts,
    expires_at: expires,
  });
  expect(result.status).toBe(201);
  const issued = repo.state.licenses.find((l) => l.id === result.data.licenses[0].id)!;
  const activated = await repo.activate(
    issued.code_hash,
    'isolated-device',
    new Date().toISOString(),
  );
  expect(activated.expires_at).toBe(expires);
  expect(
    (
      await request('/admin/licenses', {
        tier: 'pro',
        count: 1,
        duration_days: 30,
        starts_at: expires,
        expires_at: starts,
      })
    ).status,
  ).toBe(400);
});
it('refuses activation before the calendar window without binding any device', async () => {
  const result = await request('/admin/licenses', {
    tier: 'pro',
    count: 1,
    duration_days: 30,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const issued = repo.state.licenses.find((l) => l.id === result.data.licenses[0].id)!;
  await expect(
    repo.activate(issued.code_hash, 'isolated-device', new Date().toISOString()),
  ).rejects.toThrow();
  expect(repo.state.licenses.find((l) => l.id === issued.id)?.device_thumbprint).toBeNull();
});
it('calendar editing cannot bypass the independent extension permission or stale revision guard', async () => {
  const target = await staff([]);
  const actor = await staff([], ['licenses.update']);
  // The target is no longer staff: ordinary delegated managers must never change active admins.
  repo.state.admin_access = repo.state.admin_access.filter((a) => a.id !== target.id);
  const old = repo.state.licenses.find((l) => l.id === target.id)!;
  const later = new Date(Date.parse(old.expires_at!) + 86400000).toISOString();
  expect(
    (
      await request(
        `/admin/licenses/${target.id}/window`,
        { starts_at: null, expires_at: later, expected_version: 1 },
        actor.token,
      )
    ).status,
  ).toBe(403);
  const earlier = new Date(Date.parse(old.expires_at!) - 3600000).toISOString();
  expect(
    (
      await request(
        `/admin/licenses/${target.id}/window`,
        { starts_at: null, expires_at: earlier, expected_version: 1 },
        actor.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/admin/licenses/${target.id}/window`,
        { starts_at: null, expires_at: earlier, expected_version: 1 },
        actor.token,
      )
    ).status,
  ).toBe(409);
  expect(repo.state.audit_events.filter((e) => e.action === 'license.window.changed')).toHaveLength(
    1,
  );
});
it('roles.manage is usable independently without disclosing the team/license directory', async () => {
  const user = await staff([], ['roles.manage']);
  const result = await request('/admin/team', undefined, user.token);
  expect(result.status).toBe(200);
  expect(result.data.members).toEqual([]);
  expect(result.data.license_options).toEqual([]);
  expect(
    (
      await request(
        `/admin/team/${crypto.randomUUID()}`,
        { role: 'viewer', permissions: [], enabled: true },
        user.token,
      )
    ).status,
  ).toBe(403);
});
it('a disabled reusable role does not prevent revoking the associated member from an old client', async () => {
  const r = await role(['licenses.read']);
  const user = await staff([r.id]);
  repo.state.custom_roles[0].enabled = false;
  expect(
    (await request(`/admin/team/${user.id}`, { role: 'viewer', permissions: [], enabled: false }))
      .status,
  ).toBe(200);
  expect((await request('/admin/overview', undefined, user.token)).status).toBe(401);
});
it('create and update grants are independent and do not imply publication', async () => {
  const { seedPackages } = await import('../backend/src/seed');
  const p = {
    ...seedPackages()[0],
    id: crypto.randomUUID(),
    slug: 'independent-' + crypto.randomUUID(),
    status: 'draft' as const,
  };
  const creator = await staff([], ['content.create']);
  const editor = await staff([], ['content.update']);
  expect((await request('/admin/packages', p, creator.token)).status).toBe(200);
  expect(
    (await request('/admin/packages', { ...p, name: 'Changed by creator' }, creator.token)).status,
  ).toBe(403);
  expect(
    (await request('/admin/packages', { ...p, name: 'Changed by editor' }, editor.token)).status,
  ).toBe(200);
  expect(
    (
      await request(
        '/admin/packages',
        { ...p, id: crypto.randomUUID(), slug: 'other-package' },
        editor.token,
      )
    ).status,
  ).toBe(403);
  expect((await request(`/admin/packages/${p.id}/publish`, {}, editor.token)).status).toBe(403);
});
