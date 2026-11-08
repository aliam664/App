import { beforeEach, expect, it } from 'vitest';
import { exportJWK, generateKeyPair } from 'jose';
import { createApi, type ApiConfig } from '../backend/src/api';
import { LocalRepository } from '../backend/dev/store';
import { signPayload } from '../backend/src/crypto';
import { seedPackages } from '../backend/src/seed';
import { licenseState, type Permission, type PackageSpec } from '../packages/contracts/src/index';
let repo: LocalRepository, config: ApiConfig, api: ReturnType<typeof createApi>;
async function request(path: string, body?: unknown, token = repo.adminToken) {
  const r = await api(
    new Request(`https://packages.invalid/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, data: await r.json() };
}
function fresh(): PackageSpec {
  const file = crypto.randomUUID();
  return {
    ...seedPackages()[0],
    id: crypto.randomUUID(),
    slug: 'fixture-' + crypto.randomUUID(),
    dependencies: [],
    files: [
      {
        id: file,
        name: 'fixture.zip',
        url: 'https://example.com/fixture.zip',
        size: 100,
        sha256: 'a'.repeat(64),
        format: 'zip',
      },
    ],
    steps: [
      {
        id: crypto.randomUUID(),
        file_id: file,
        action: 'extract',
        destination: 'content/cars',
        overwrite: 'fail',
      },
    ],
    status: 'draft',
    version: '1.0.0',
    released_at: null,
    revision: undefined,
  };
}
async function save(p = fresh(), token = repo.adminToken) {
  const r = await request('/admin/packages', p, token);
  expect(r.status).toBe(200);
  return r.data.package as PackageSpec;
}
async function staff(permissions: Permission[]) {
  const id = crypto.randomUUID();
  repo.state.licenses.push({
    id,
    prefix: 'QA',
    code_hash: id,
    tier: 'normal',
    status: 'active',
    duration_days: 1,
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    device_thumbprint: 'fixture-device',
    entitlement_version: 1,
    activation_count: 1,
  });
  repo.state.admin_access.push({
    id,
    role: 'viewer',
    permissions,
    role_ids: [],
    enabled: true,
    version: 1,
    updated_at: new Date().toISOString(),
  });
  return {
    id,
    token: await signPayload(
      {
        license_id: id,
        device_thumbprint: 'fixture-device',
        access_version: 1,
        entitlement_version: 1,
      },
      config,
      'uhm-admin+jwt',
      900,
    ),
  };
}
beforeEach(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  config = {
    mode: 'production',
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
    pepper: 'isolated-only',
    kid: 'test',
    issuer: 'https://packages.invalid',
    allowedOrigins: [],
  };
  repo = new LocalRepository();
  api = createApi(repo, config);
});
it('independently enforces category administration and detects stale category writes', async () => {
  const creator = await staff(['content.create']);
  expect(
    (
      await request(
        '/admin/categories/qa',
        { name: 'آزمایش', enabled: true, expected_version: 0 },
        creator.token,
      )
    ).status,
  ).toBe(403);
  const manager = await staff(['categories.manage']);
  expect(
    (
      await request(
        '/admin/categories/qa',
        { name: 'آزمایش', enabled: true, expected_version: 0 },
        manager.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        '/admin/categories/qa',
        { name: 'تداخل', enabled: true, expected_version: 0 },
        manager.token,
      )
    ).data.error,
  ).toBe('EDIT_CONFLICT');
  expect(repo.state.package_categories.find((c) => c.id === 'qa')!.name).toBe('آزمایش');
  expect((await request('/admin/overview', undefined, manager.token)).data.packages).toEqual([]);
});
it('retains published content when its category is disabled but blocks new publication', async () => {
  const p = await save();
  await request(`/admin/packages/${p.id}/publish`, { expected_revision: 1 });
  const category = repo.state.package_categories.find((c) => c.id === p.category)!;
  await request(`/admin/categories/${p.category}`, {
    name: category.name,
    enabled: false,
    expected_version: category.version,
  });
  expect((await request('/catalog')).data.packages.map((p: any) => p.id)).toContain(p.id);
  const draft = await save({ ...repo.state.packages[0], version: '1.0.1', status: 'draft' });
  expect(
    (await request(`/admin/packages/${p.id}/publish`, { expected_revision: draft.revision })).data
      .error,
  ).toBe('CATEGORY_UNAVAILABLE');
});
it('compares package revision and does not add an audit record for a rejected update', async () => {
  const p = await save();
  const next = await save({ ...p, name: 'New draft name' });
  const n = repo.state.audit_events.length;
  expect((await request('/admin/packages', { ...p, name: 'Lost update' })).data.error).toBe(
    'EDIT_CONFLICT',
  );
  expect(repo.state.audit_events).toHaveLength(n);
  expect(repo.state.packages[0].name).toBe(next.name);
});
it('permits legacy 0.1.1 package payloads without a revision', async () => {
  const p = await save();
  const { revision, ...legacy } = p;
  expect((await request('/admin/packages', { ...legacy, name: 'Legacy editor' })).status).toBe(200);
  expect(repo.state.packages[0].revision).toBe(2);
});
it('requires exact deletion confirmation and the independent delete grant', async () => {
  const p = await save();
  const publisher = await staff(['content.publish']);
  const input = { confirm_slug: p.slug, expected_revision: 1 };
  expect((await request(`/admin/packages/${p.id}/delete`, input, publisher.token)).status).toBe(
    403,
  );
  expect(
    (await request(`/admin/packages/${p.id}/delete`, { ...input, confirm_slug: 'wrong' })).data
      .error,
  ).toBe('CONFIRMATION_REQUIRED');
  const deleter = await staff(['content.delete']);
  expect((await request(`/admin/packages/${p.id}/delete`, input, deleter.token)).status).toBe(200);
  expect(repo.state.packages[0].deleted_at).toBeTruthy();
  expect((await request('/admin/overview')).data.packages).toEqual([]);
  expect((await request('/catalog')).data.packages).toEqual([]);
  expect((await request('/admin/packages', { ...p, revision: 2 })).data.error).toBe(
    'PACKAGE_DELETED',
  );
});
it('rejects deletion while a live immutable dependency snapshot refers to the package', async () => {
  const dep = await save();
  await request(`/admin/packages/${dep.id}/publish`, {});
  const parent = await save({ ...fresh(), dependencies: [dep.id] });
  await request(`/admin/packages/${parent.id}/publish`, {});
  expect(
    (
      await request(`/admin/packages/${dep.id}/delete`, {
        confirm_slug: dep.slug,
        expected_revision: 2,
      })
    ).data.error,
  ).toBe('PACKAGE_IN_USE');
  expect(repo.state.packages.find((p) => p.id === dep.id)!.deleted_at).toBeNull();
});
it('restores immutable release metadata as a forward-version draft, not an installed downgrade', async () => {
  const p = await save();
  await request(`/admin/packages/${p.id}/publish`, {});
  const release = structuredClone(repo.state.releases[0]);
  const draft = await save({
    ...repo.state.packages[0],
    name: 'Next draft',
    version: '1.0.1',
    status: 'draft',
  });
  const restorer = await staff(['content.versions']);
  const input = {
    release_version: '1.0.0',
    new_version: '1.0.2',
    expected_revision: draft.revision,
  };
  const r = await request(`/admin/packages/${p.id}/restore`, input, restorer.token);
  expect(r.status).toBe(200);
  expect(r.data.package).toMatchObject({
    version: '1.0.2',
    name: release.name,
    status: 'draft',
    released_at: null,
    scheduled_at: null,
    revision: 4,
  });
  expect(repo.state.releases[0]).toEqual(release);
  expect((await request('/catalog')).data.packages[0].version).toBe('1.0.0');
  expect(
    (
      await request(
        `/admin/packages/${p.id}/restore`,
        { ...input, new_version: '1.0.0', expected_revision: 4 },
        restorer.token,
      )
    ).data.error,
  ).toBe('VERSION_MUST_INCREASE');
});
it('does not leak passwords, artifact links, user secrets or device bindings through unrelated grants', async () => {
  const p = fresh();
  p.files[0].archive_password = 'fixture-secret';
  await save(p);
  const reader = await staff(['content.read', 'users.read']);
  const o = (await request('/admin/overview', undefined, reader.token)).data;
  expect(o.packages[0].files).toEqual([]);
  const users = (await request('/admin/users', undefined, reader.token)).data.users;
  expect(JSON.stringify(users)).not.toContain('fixture-device');
  expect(users[0]).not.toHaveProperty('code_hash');
  expect((await request('/admin/devices', undefined, reader.token)).status).toBe(403);
  expect((await request('/catalog')).data.packages).toEqual([]);
});
it('keeps users.manage independent of directory reads, licenses and device reset powers', async () => {
  const editor = await staff(['users.manage']);
  expect((await request('/admin/users', undefined, editor.token)).status).toBe(403);
  expect(
    (
      await request(
        `/admin/users/${editor.id}`,
        { display_name: 'QA name', notes: 'internal', tags: ['test'] },
        editor.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/admin/users/${editor.id}`,
        { display_name: 'bad', notes: '', tags: [], tier: 'vip' },
        editor.token,
      )
    ).status,
  ).toBe(400);
  expect(repo.state.licenses[0].tier).toBe('normal');
  expect((await request(`/admin/licenses/${editor.id}/reset`, {}, editor.token)).status).toBe(403);
  expect((await request('/admin/devices', undefined, editor.token)).status).toBe(403);
});
it('gives device viewers only the device directory, not license controls or user notes', async () => {
  const viewer = await staff(['devices.read']);
  expect((await request('/admin/users', undefined, viewer.token)).status).toBe(403);
  const r = await request('/admin/devices', undefined, viewer.token);
  expect(r.status).toBe(200);
  expect(r.data.devices[0].device_thumbprint).toBe('fixture-device');
  expect(r.data.devices[0]).not.toHaveProperty('notes');
  expect(r.data.devices[0]).not.toHaveProperty('code_hash');
  expect((await request('/admin/overview', undefined, viewer.token)).data.licenses).toEqual([]);
});
it('rolls back local manifest and audit together when persistence fails', async () => {
  const broken = new LocalRepository(undefined, async () => {
    throw new Error('disk full');
  });
  await expect(broken.commitPackage(fresh(), 'qa', 'save')).rejects.toThrow('disk full');
  expect(broken.state.packages).toEqual([]);
  expect(broken.state.audit_events).toEqual([]);
});
it('computes suspended/revoked, expiry and scheduled states consistently', () => {
  const base = {
    status: 'active' as const,
    expires_at: new Date(Date.now() - 1000).toISOString(),
    starts_at: null,
  };
  expect(licenseState(base)).toBe('expired');
  expect(licenseState({ ...base, status: 'suspended' })).toBe('suspended');
  expect(licenseState({ ...base, status: 'revoked' })).toBe('revoked');
  expect(
    licenseState({
      ...base,
      expires_at: null,
      starts_at: new Date(Date.now() + 10000).toISOString(),
    }),
  ).toBe('scheduled');
});
