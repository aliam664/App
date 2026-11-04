/** Disposable PostgreSQL + actual API/crypto pipeline. No production keys, database or user data. */
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';
import { LocalRepository } from '../backend/dev/store';
import { createApi, type ApiConfig } from '../backend/src/api';
import { b64, codeHash, verifyToken } from '../backend/src/crypto';
import { type Table, type Tables, type PackageSpec } from '../packages/contracts/src/index';
const out = process.argv[2];
const sha = process.env.GITHUB_SHA;
if (!out || !sha || !/^[a-f0-9]{40}$/.test(sha))
  throw new Error('Explicit disposable output directory and pinned GITHUB_SHA required');
const db = new PGlite();
await db.exec(
  'create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);',
);
for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
class PgRepository extends LocalRepository {
  async list<T extends Table>(table: T): Promise<Tables[T][]> {
    return json((await db.query(`select * from uhm.${table}`)).rows) as Tables[T][];
  }
  async insert<T extends Table>(table: T, rows: Tables[T][]) {
    for (const row of rows) {
      const keys = Object.keys(row).filter((k) => (row as any)[k] !== undefined);
      if (!keys.every((k) => /^[a-z_]+$/.test(k))) throw new Error('Unsafe column');
      await db.query(
        `insert into uhm.${table}(${keys.join(',')}) select ${keys.map((k) => `r.${k}`).join(',')} from jsonb_populate_record(null::uhm.${table},$1) r`,
        [JSON.stringify(row)],
      );
    }
  }
  async activate(hash: string, thumb: string, _now: string) {
    return (await db.query<any>('select uhm.activate_license($1,$2) as value', [hash, thumb]))
      .rows[0].value;
  }
  async consumeChallenge(id: string, thumb: string, _now: string) {
    return (await db.query<any>('select uhm.consume_challenge($1,$2) as value', [id, thumb]))
      .rows[0].value;
  }
  async rateLimit(key: string, limit: number, seconds: number) {
    return (
      await db.query<any>('select uhm.take_rate_limit($1,$2,$3) as value', [key, limit, seconds])
    ).rows[0].value;
  }
  async published() {
    return (await db.query<any>('select uhm.published_packages() as value')).rows.map(
      (r) => r.value,
    ) as PackageSpec[];
  }
  async releases() {
    return json(
      (await db.query('select * from uhm.package_releases order by published_at desc')).rows,
    ) as Awaited<ReturnType<LocalRepository['releases']>>;
  }
  async commitPackage(
    pkg: PackageSpec,
    actor: string,
    action: 'save' | 'publish' | 'archive' | 'delete' | 'restore',
    expected?: number,
  ) {
    return (
      await db.query<any>('select uhm.commit_package($1,$2,$3,$4) as value', [
        JSON.stringify(pkg),
        actor,
        action,
        expected ?? null,
      ])
    ).rows[0].value as Awaited<ReturnType<LocalRepository['commitPackage']>>;
  }
  async admin() {
    return null;
  } // No magic admin token: the synthetic owner must prove its license/device.
}
const repo = new PgRepository();
const pair = await generateKeyPair('ES256', { extractable: true });
const config: ApiConfig = {
  mode: 'production',
  privateJwk: await exportJWK(pair.privateKey),
  publicJwk: await exportJWK(pair.publicKey),
  pepper: crypto.randomUUID(),
  kid: 'isolated-package-smoke',
  issuer: 'https://isolated-package-smoke.invalid',
  allowedOrigins: [],
};
const api = createApi(repo, config);
async function call(path: string, body?: unknown, token?: string) {
  const response = await api(
    new Request(`https://isolated-package-smoke.invalid/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    'isolated-runner',
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const device = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const jwk = await crypto.subtle.exportKey('jwk', device.publicKey);
const public_key = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
async function proof(purpose: string) {
  const c = await call('/device/challenge', { public_key, purpose });
  return {
    public_key,
    challenge_id: c.id,
    signature: b64(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          device.privateKey,
          new TextEncoder().encode(`UHM:device-proof:v1:${c.nonce}`),
        ),
      ),
    ),
  };
}
const ownerId = crypto.randomUUID(),
  ownerCode = 'UHM-ISOLATED-OWNER-' + crypto.randomUUID();
await repo.insert('licenses', [
  {
    id: ownerId,
    code_hash: await codeHash(ownerCode, config.pepper),
    prefix: 'QA-OWNER',
    tier: 'vip',
    status: 'unused',
    duration_days: 1,
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    device_thumbprint: null,
    entitlement_version: 1,
    activation_count: 0,
  },
]);
await repo.insert('admin_access', [
  {
    id: ownerId,
    role: 'owner',
    permissions: [],
    role_ids: [],
    enabled: true,
    version: 1,
    updated_at: new Date().toISOString(),
  },
]);
await call('/licenses/activate', { code: ownerCode, ...(await proof('activate')) });
const admin = (
  await call('/admin/license-session', { license_id: ownerId, ...(await proof('admin')) })
).token;
const generated = await call(
  '/admin/licenses',
  { tier: 'normal', duration_days: 1, count: 1 },
  admin,
);
const bytes = await readFile('tests/fixtures/package-smoke.zip');
const hash = createHash('sha256').update(bytes).digest('hex');
const fileId = crypto.randomUUID(),
  id = crypto.randomUUID();
const url = `https://github.com/aliam664/App/raw/${sha}/tests/fixtures/package-smoke.zip`;
let pkg: PackageSpec = {
  id,
  slug: 'uhm-isolated-fixture',
  name: 'UHM isolated package',
  description:
    'Small synthetic package for real download, extraction, installation and local library scanning. Not an Assetto Corsa game asset.',
  category: 'cars',
  tier: 'normal',
  image: '/images/09.jpg',
  version: '1.0.0',
  content_type: 'car',
  author: 'UHM QA',
  brand: 'UHM Test',
  tags: ['isolated', 'synthetic'],
  channel: 'stable',
  changelog: 'Deterministic ZIP fixture.',
  dependencies: [],
  files: [
    {
      id: fileId,
      name: 'package-smoke.zip',
      url: `https://github.com/aliam664/App/raw/${sha}/tests/fixtures/missing-fixture.zip`,
      mirrors: [url],
      sha256: hash,
      size: bytes.length,
      format: 'zip',
    },
  ],
  steps: [
    {
      id: crypto.randomUUID(),
      file_id: fileId,
      action: 'extract',
      source_subdir: 'bundle/car',
      destination: 'content/cars/uhm_fixture_car',
      overwrite: 'fail',
    },
  ],
  status: 'draft',
  released_at: null,
};
pkg = (await call('/admin/packages', pkg, admin)).package;
pkg = (
  await call('/admin/packages', { ...pkg, name: 'UHM isolated package — edited draft' }, admin)
).package;
await call(`/admin/packages/${id}/validate`, {}, admin);
await call(`/admin/packages/${id}/publish`, { expected_revision: pkg.revision }, admin);
const catalog = await call('/catalog');
if (!catalog.packages.some((p: PackageSpec) => p.id === id))
  throw new Error('Published package not visible to test account');
const activation = await call('/licenses/activate', {
  code: generated.codes[0],
  ...(await proof('activate')),
});
const response = await call(
  '/install/plan',
  { package_id: id, ...(await proof('plan')) },
  activation.grant,
);
const plan = await verifyToken(response.plan, config, 'uhm-plan+jwt');
if ((plan.packages as any[]).length !== 1) throw new Error('Unexpected dependency plan');
await mkdir(out, { recursive: true });
await writeFile(
  `${out}/package-chain.json`,
  JSON.stringify(
    {
      public_key: config.publicJwk,
      issuer: config.issuer,
      kid: config.kid,
      grant: activation.grant,
      plan: response.plan,
      package_id: id,
      sha256: hash,
      bytes: bytes.length,
      checks: [
        'PostgreSQL migrations and normalized children',
        'License/device owner proof',
        'Admin draft create and edit',
        'Publication validation and immutable snapshot',
        'Test-account activation and catalog visibility',
        'Signed entitlement and device-bound install plan',
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    ok: true,
    stage: 'api-postgresql',
    package_id: id,
    bytes: bytes.length,
    sha256: hash,
    output: `${out}/package-chain.json`,
  }),
);
await db.close();
