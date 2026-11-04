import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { PackageSpec } from '../packages/contracts/src/index';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);`,
  );
  await db.exec(await readFile('supabase/migrations/202611010001_platform.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202611010002_live_catalog.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202611020003_admin_telemetry.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261102201702_content_packages.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261104085627_custom_roles.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261104085636_license_windows.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261104085700_package_workflows.sql', 'utf8'));
});
afterAll(async () => {
  await db.close();
});
it('installs all tables and enforces RLS on each', async () => {
  const result = await db.query<{ tablename: string; rowsecurity: boolean }>(
    "select tablename,rowsecurity from pg_tables where schemaname='uhm'",
  );
  expect(result.rows.length).toBe(16);
  expect(result.rows.every((r) => r.rowsecurity)).toBe(true);
});
it('has no anon/public RPC execution privilege', async () => {
  const r = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('anon','uhm.activate_license(text,text)','execute') as allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});
it('denies browser roles access to license data', async () => {
  await db.exec('set role anon');
  await expect(db.query('select * from uhm.licenses')).rejects.toThrow();
  await db.exec('reset role');
});
it('binds once, permits same-device retry and rejects another device', async () => {
  await db.exec(
    `insert into uhm.licenses(id,code_hash,prefix,tier,duration_days) values('20000000-0000-4000-8000-000000000001','hash-one','UHM-TEST','pro',30)`,
  );
  await db.exec('set role service_role');
  await db.query('select uhm.activate_license($1,$2)', ['hash-one', 'device-one']);
  await db.query('select uhm.activate_license($1,$2)', ['hash-one', 'device-one']);
  await expect(
    db.query('select uhm.activate_license($1,$2)', ['hash-one', 'device-two']),
  ).rejects.toThrow();
  const r = await db.query<{ activation_count: number }>(
    'select activation_count from uhm.licenses where code_hash=$1',
    ['hash-one'],
  );
  expect(r.rows[0].activation_count).toBe(1);
  await db.exec('reset role');
});
it('keeps audit mutation and license update in the same transaction', async () => {
  await db.exec('set role service_role');
  await db.query('select uhm.mutate_license($1,$2,$3,$4)', [
    '20000000-0000-4000-8000-000000000001',
    'revoke',
    'owner-test',
    30,
  ]);
  const r = await db.query<{ action: string }>(
    "select action from uhm.audit_events where actor='owner-test'",
  );
  expect(r.rows[0].action).toBe('license.revoke');
  await expect(
    db.query('select uhm.mutate_license($1,$2,$3,$4)', [
      '20000000-0000-4000-8000-000000000001',
      'suspend',
      'owner-test',
      30,
    ]),
  ).rejects.toThrow();
  await db.exec('reset role');
});
it('stores immutable snapshots and refuses repeated release version', async () => {
  const id = '20000000-0000-4000-8000-000000000002';
  await db.query(
    `insert into uhm.packages(id,slug,name,description,category,tier,image,version,files,steps,status) values($1,'test','Test','Test description','tools','normal','/images/01.jpg','1.0.0','[{"id":"60000000-0000-4000-8000-000000000001","name":"test.zip","url":"https://example.com/test.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":100,"format":"zip"}]','[{"id":"60000000-0000-4000-8000-000000000002","file_id":"60000000-0000-4000-8000-000000000001","action":"extract","destination":"content/cars","overwrite":"backup"}]','draft')`,
    [id],
  );
  await db.exec('set role service_role');
  await db.query("update uhm.packages set status='published' where id=$1", [id]);
  const r = await db.query<{ version: string }>(
    'select version from uhm.package_releases where package_id=$1',
    [id],
  );
  expect(r.rows[0].version).toBe('1.0.0');
  await expect(
    db.query("update uhm.packages set name='Changed' where id=$1", [id]),
  ).rejects.toThrow();
  await expect(
    db.query("update uhm.package_releases set version='2.0.0' where package_id=$1", [id]),
  ).rejects.toThrow();
  await db.exec('reset role');
});
it('rate limit increments atomically and denies beyond budget', async () => {
  await db.exec('set role service_role');
  for (let i = 0; i < 3; i++) {
    const r = await db.query<{ allowed: boolean }>(
      "select uhm.take_rate_limit('rate-test',2,60) as allowed",
    );
    expect(r.rows[0].allowed).toBe(i < 2);
  }
  await db.exec('reset role');
});

it('preserves the current published release while a replacement is drafted', async () => {
  const id = '20000000-0000-4000-8000-000000000002';
  await db.exec('set role service_role');
  await db.query(
    "update uhm.packages set status='draft',version='2.0.0',name='New draft' where id=$1",
    [id],
  );
  const r = await db.query<{ manifest: { id: string; version: string; name: string } }>(
    'select uhm.published_packages() as manifest',
  );
  expect(r.rows.find((r) => r.manifest.id === id)?.manifest.version).toBe('1.0.0');
  expect(r.rows.find((r) => r.manifest.id === id)?.manifest.name).toBe('Test');
  await db.query("update uhm.packages set status='archived' where id=$1", [id]);
  expect((await db.query('select uhm.published_packages()')).rows).toHaveLength(0);
  await db.exec('reset role');
});
it('does not expose signed download manifests through a public catalog RPC', async () => {
  const r = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('anon','uhm.published_packages()','execute') as allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});

it('protects new telemetry, staff, service tables and aggregate RPC from browser roles', async () => {
  for (const table of ['admin_access', 'telemetry_events', 'service_settings']) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_table_privilege('anon','uhm.${table}','select') as allowed`,
    );
    expect(r.rows[0].allowed).toBe(false);
  }
  const r = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','uhm.dashboard_analytics(timestamptz)','execute') as allowed",
  );
  expect(r.rows[0].allowed).toBe(false);
});
it('atomically retains the last owner and records changes', async () => {
  const id = '30000000-0000-4000-8000-000000000001';
  await db.exec(
    `insert into uhm.licenses(id,code_hash,prefix,tier,duration_days) values('${id}','admin-test-hash','TEST','pro',30)`,
  );
  await db.query('select uhm.save_admin_access($1::jsonb,$2)', [
    JSON.stringify({ id, role: 'owner', enabled: true, permissions: [] }),
    'bootstrap',
  ]);
  await expect(
    db.query('select uhm.save_admin_access($1::jsonb,$2)', [
      JSON.stringify({ id, role: 'viewer', enabled: true, permissions: [] }),
      'bootstrap',
    ]),
  ).rejects.toThrow('LAST_OWNER');
  const r = await db.query<{ role: string }>('select role from uhm.admin_access where id=$1', [id]);
  expect(r.rows[0].role).toBe('owner');
});
it('deduplicates event IDs and aggregates by occurrence date, not upload date', async () => {
  const license = '30000000-0000-4000-8000-000000000001';
  const id = '40000000-0000-4000-8000-000000000001';
  for (let i = 0; i < 2; i++)
    await db.query(
      `insert into uhm.telemetry_events(id,license_id,type,occurred_at,session_id) values($1,$2,'app_open','2026-11-01T12:00:00Z',$1) on conflict(license_id,id) do nothing`,
      [id, license],
    );
  const r = await db.query<{ data: any }>("select uhm.dashboard_analytics('2026-10-01') as data");
  expect(r.rows[0].data.totals).toEqual([{ type: 'app_open', count: 1 }]);
  expect(r.rows[0].data.daily[0].day).toBe('2026-11-01');
});

it('normalizes package children atomically and denies browser access', async () => {
  const id = '20000000-0000-4000-8000-000000000002';
  const files = await db.query<{ name: string }>(
    'select name from uhm.package_files where package_id=$1',
    [id],
  );
  expect(files.rows[0].name).toBe('test.zip');
  const steps = await db.query<{ destination: string }>(
    'select destination from uhm.package_steps where package_id=$1',
    [id],
  );
  expect(steps.rows[0].destination).toBe('content/cars');
  for (const table of ['package_files', 'package_steps', 'package_dependencies']) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_table_privilege('anon','uhm.${table}','select') as allowed`,
    );
    expect(r.rows[0].allowed).toBe(false);
  }
});
it('keeps last stable version visible through future and test releases', async () => {
  const id = '20000000-0000-4000-8000-000000000002';
  await db.exec('set role service_role');
  await db.query(
    "update uhm.packages set status='draft',version='3.0.0',scheduled_at=now()+interval '1 year' where id=$1",
    [id],
  );
  await db.query("update uhm.packages set status='published' where id=$1", [id]);
  let r = await db.query<{ manifest: { version: string } }>(
    'select uhm.published_packages() as manifest',
  );
  expect(r.rows[0].manifest.version).toBe('1.0.0');
  await db.query(
    "update uhm.packages set status='draft',version='4.0.0',scheduled_at=null,channel='test' where id=$1",
    [id],
  );
  await db.query("update uhm.packages set status='published' where id=$1", [id]);
  r = await db.query<{ manifest: { version: string } }>(
    'select uhm.published_packages() as manifest',
  );
  expect(r.rows[0].manifest.version).toBe('1.0.0');
  await expect(
    db.query("update uhm.packages set author='mutated' where id=$1", [id]),
  ).rejects.toThrow('RELEASE_IMMUTABLE');
  await db.exec('reset role');
});
it('custom roles enforce atomic revisions, audit history and no browser grants', async () => {
  const id = '20000000-0000-4000-8000-000000000050';
  const input = {
    id,
    name: 'Isolated role',
    description: 'Synthetic only',
    permissions: ['licenses.read'],
    enabled: true,
  };
  await db.exec('set role service_role');
  await db.query('select uhm.save_custom_role($1,$2,$3)', [
    JSON.stringify(input),
    'test-role-owner',
    0,
  ]);
  await expect(
    db.query('select uhm.save_custom_role($1,$2,$3)', [
      JSON.stringify({ ...input, permissions: [] }),
      'test-role-owner',
      0,
    ]),
  ).rejects.toThrow('EDIT_CONFLICT');
  const row = await db.query<{ version: number }>(
    'select version from uhm.custom_roles where id=$1',
    [id],
  );
  expect(row.rows[0].version).toBe(1);
  const events = await db.query<{ count: number }>(
    "select count(*)::integer as count from uhm.audit_events where actor='test-role-owner'",
  );
  expect(events.rows[0].count).toBe(1);
  await db.exec('reset role; set role anon');
  await expect(db.query('select * from uhm.custom_roles')).rejects.toThrow();
  await expect(
    db.query('select uhm.save_custom_role($1,$2,$3)', [JSON.stringify(input), 'attacker', 1]),
  ).rejects.toThrow();
  await db.exec('reset role');
});
it('calendar windows enforce not-before, fixed expiry, revisions and atomic audit in PostgreSQL', async () => {
  const id = '20000000-0000-4000-8000-000000000060';
  await db.query(
    "insert into uhm.licenses(id,code_hash,prefix,tier,duration_days,starts_at,expires_at) values($1,'calendar-only','TEST','normal',30,now()+interval '1 day',now()+interval '2 days')",
    [id],
  );
  await db.exec('set role service_role');
  await expect(
    db.query("select uhm.activate_license('calendar-only','isolated-device')"),
  ).rejects.toThrow('ACTIVATION_DENIED');
  const expires = new Date(Date.now() + 86400000).toISOString();
  await db.query('select uhm.set_license_window($1,$2,$3)', [
    id,
    JSON.stringify({ starts_at: null, expires_at: expires, expected_version: 1 }),
    'calendar-test',
  ]);
  await db.query("select uhm.activate_license('calendar-only','isolated-device')");
  const row = await db.query<{ expires_at: Date; entitlement_version: number }>(
    'select expires_at,entitlement_version from uhm.licenses where id=$1',
    [id],
  );
  expect(new Date(row.rows[0].expires_at).toISOString()).toBe(expires);
  expect(row.rows[0].entitlement_version).toBe(2);
  await expect(
    db.query('select uhm.set_license_window($1,$2,$3)', [
      id,
      JSON.stringify({ starts_at: null, expires_at: null, expected_version: 2 }),
      'calendar-test',
    ]),
  ).rejects.toThrow('INVALID_ACTION');
  const events = await db.query<{ count: number }>(
    "select count(*)::integer as count from uhm.audit_events where actor='calendar-test'",
  );
  expect(events.rows[0].count).toBe(1);
  await db.exec('reset role');
});

function sqlPackage(): PackageSpec {
  const id = crypto.randomUUID(),
    file = crypto.randomUUID();
  return {
    id,
    slug: 'pg-' + id,
    name: 'PostgreSQL package',
    description: 'Disposable valid manifest for database tests.',
    category: 'tools',
    tier: 'normal',
    image: '/images/01.jpg',
    version: '1.0.0',
    changelog: '',
    dependencies: [],
    files: [
      {
        id: file,
        name: 'pg.zip',
        url: 'https://example.com/pg.zip',
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
        destination: 'extension',
        overwrite: 'fail',
      },
    ],
    status: 'draft',
    released_at: null,
  };
}
async function commitSql(
  p: ReturnType<typeof sqlPackage>,
  action: string,
  revision: number,
  actor = 'package-sql',
) {
  return (
    await db.query<{
      value: ReturnType<typeof sqlPackage> & { revision: number; deleted_at: string | null };
    }>('select uhm.commit_package($1,$2,$3,$4) as value', [
      JSON.stringify(p),
      actor,
      action,
      revision,
    ])
  ).rows[0].value;
}
it('executes package RPCs with normalized children, immutable releases and revision CAS', async () => {
  const p = sqlPackage();
  await db.exec('set role service_role');
  const saved = await commitSql(p, 'save', 0);
  expect(saved.revision).toBe(1);
  expect(
    (await db.query('select * from uhm.package_files where package_id=$1', [p.id])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query('select * from uhm.package_steps where package_id=$1', [p.id])).rows,
  ).toHaveLength(1);
  const published = await commitSql(
    { ...p, status: 'published', released_at: new Date().toISOString() },
    'publish',
    1,
  );
  expect(published.revision).toBe(2);
  await expect(commitSql({ ...p, name: 'Stale editor' }, 'save', 1)).rejects.toThrow(
    'EDIT_CONFLICT',
  );
  await expect(commitSql(p, 'save', 2)).rejects.toThrow('RELEASE_IMMUTABLE');
  const restored = await commitSql({ ...p, version: '1.0.1' }, 'restore', 2);
  expect(restored.revision).toBe(3);
  const releases = await db.query<{ manifest: { version: string } }>(
    'select manifest from uhm.package_releases where package_id=$1',
    [p.id],
  );
  expect(releases.rows.map((r) => r.manifest.version)).toEqual(['1.0.0']);
  expect(
    (await db.query('select * from uhm.audit_events where target=$1', [p.id])).rows,
  ).toHaveLength(3);
  await db.exec('reset role');
});
it('rolls back the entire package, child-sync and snapshot transaction if audit insertion fails', async () => {
  const p = sqlPackage();
  await db.exec(
    "create function uhm.reject_fixture_audit() returns trigger language plpgsql as $$ begin if new.actor='force-package-audit-failure' then raise exception 'Audit unavailable'; end if; return new; end $$; create trigger reject_fixture_audit before insert on uhm.audit_events for each row execute function uhm.reject_fixture_audit(); set role service_role",
  );
  await expect(commitSql(p, 'save', 0, 'force-package-audit-failure')).rejects.toThrow(
    'Audit unavailable',
  );
  expect((await db.query('select * from uhm.packages where id=$1', [p.id])).rows).toEqual([]);
  expect(
    (await db.query('select * from uhm.package_files where package_id=$1', [p.id])).rows,
  ).toEqual([]);
  await db.exec(
    'reset role; drop trigger reject_fixture_audit on uhm.audit_events; drop function uhm.reject_fixture_audit()',
  );
});
it('preserves released dependencies against soft-deletion and hides deleted packages without deleting history', async () => {
  const dep = sqlPackage(),
    parent = { ...sqlPackage(), dependencies: [dep.id] };
  await db.exec('set role service_role');
  await commitSql(dep, 'save', 0);
  const release: PackageSpec = {
    ...dep,
    status: 'published',
    released_at: new Date().toISOString(),
  };
  await commitSql(release, 'publish', 1);
  await commitSql(parent, 'save', 0);
  await commitSql(
    { ...parent, status: 'published', released_at: new Date().toISOString() },
    'publish',
    1,
  );
  await expect(commitSql({ ...release, status: 'archived' }, 'delete', 2)).rejects.toThrow(
    'PACKAGE_IN_USE',
  );
  await commitSql({ ...parent, status: 'archived' }, 'archive', 2);
  const deleted = await commitSql({ ...release, status: 'archived' }, 'delete', 2);
  expect(deleted.deleted_at).toBeTruthy();
  expect(
    (await db.query<{ p: { id: string } }>('select uhm.published_packages() as p')).rows.some(
      (r) => r.p.id === dep.id,
    ),
  ).toBe(false);
  expect(
    (await db.query('select * from uhm.package_releases where package_id=$1', [dep.id])).rows,
  ).toHaveLength(1);
  await db.exec('reset role');
});
it('category and profile RPCs enforce CAS/atomic audit and never alter device or tier', async () => {
  await db.exec('set role service_role');
  await db.query('select uhm.save_package_category($1,$2,$3)', [
    JSON.stringify({ id: 'qa-sql', name: 'دسته آزمایش', enabled: true }),
    'category-qa',
    0,
  ]);
  await expect(
    db.query('select uhm.save_package_category($1,$2,$3)', [
      JSON.stringify({ id: 'qa-sql', name: 'stale', enabled: false }),
      'category-qa',
      0,
    ]),
  ).rejects.toThrow('EDIT_CONFLICT');
  const p = { ...sqlPackage(), category: 'qa-sql' };
  await commitSql(p, 'save', 0);
  await db.query('select uhm.save_package_category($1,$2,$3)', [
    JSON.stringify({ id: 'qa-sql', name: 'دسته آزمایش', enabled: false }),
    'category-qa',
    1,
  ]);
  await expect(commitSql({ ...p, status: 'published' }, 'publish', 1)).rejects.toThrow(
    'CATEGORY_UNAVAILABLE',
  );
  const id = '20000000-0000-4000-8000-000000000060';
  const before = (await db.query<any>('select * from uhm.licenses where id=$1', [id])).rows[0];
  await db.query('select uhm.save_user_profile($1,$2,$3)', [
    id,
    JSON.stringify({ display_name: 'نام آزمایش', notes: 'internal', tags: ['qa'] }),
    'profile-qa',
  ]);
  const after = (await db.query<any>('select * from uhm.licenses where id=$1', [id])).rows[0];
  expect(after).toMatchObject({
    display_name: 'نام آزمایش',
    notes: 'internal',
    tags: ['qa'],
    tier: before.tier,
    device_thumbprint: before.device_thumbprint,
    entitlement_version: before.entitlement_version,
  });
  for (const signature of [
    'uhm.save_package_category(jsonb,text,integer)',
    'uhm.commit_package(jsonb,text,text,integer)',
    'uhm.save_user_profile(uuid,jsonb,text)',
  ]) {
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon',$1,'execute') as allowed",
          [signature],
        )
      ).rows[0].allowed,
    ).toBe(false);
  }
  await db.exec('reset role');
});
it('rechecks the live graph inside publication after a dependency disappears or forms a cycle', async () => {
  await db.exec('set role service_role');
  const dep = sqlPackage(),
    parent = { ...sqlPackage(), dependencies: [dep.id] };
  await commitSql(dep, 'save', 0);
  await commitSql({ ...dep, status: 'published' }, 'publish', 1);
  await commitSql(parent, 'save', 0);
  // Represents an API-valid draft whose prerequisite was removed before its publish RPC acquired the lock.
  await commitSql({ ...dep, status: 'archived' }, 'archive', 2);
  await expect(commitSql({ ...parent, status: 'published' }, 'publish', 1)).rejects.toThrow(
    'DEPENDENCY_UNAVAILABLE',
  );
  // Restore a newer live prerequisite; concurrent mutual drafts must not publish a cycle.
  const next = { ...dep, version: '1.0.1' };
  await commitSql(next, 'save', 3);
  await commitSql({ ...next, status: 'published' }, 'publish', 4);
  await commitSql({ ...parent, status: 'published' }, 'publish', 1);
  const cyclic = { ...dep, version: '1.0.2', dependencies: [parent.id] };
  await commitSql(cyclic, 'save', 5);
  await expect(commitSql({ ...cyclic, status: 'published' }, 'publish', 6)).rejects.toThrow(
    'DEPENDENCY_CYCLE',
  );
  await db.exec('reset role');
});
