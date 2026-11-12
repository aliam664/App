/** Fixed commissioning checks. Uses a throwaway owner, NEVER the user's owner license. */
import { importJWK, jwtVerify, calculateJwkThumbprint } from 'jose';
import production from '../config/production-public.json';
import { version as appVersion } from '../package.json';
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`Commissioning failed: ${label}`);
}
export async function runLiveSmoke(code: string) {
  const checks: string[] = [];
  const origin = 'https://aliam664.github.io';
  async function request(path: string, body?: unknown, token?: string, expected = 200) {
    const response = await fetch(`${production.api_base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    check(
      response.status === expected,
      `${path} returned ${response.status}, expected ${expected}`,
    );
    check(response.headers.get('Access-Control-Allow-Origin') === origin, 'approved CORS origin');
    return response.json();
  }
  async function device() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    return { keys, public_key: { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! } };
  }
  async function proof(d: Awaited<ReturnType<typeof device>>, purpose: string) {
    const c = await request('/device/challenge', { public_key: d.public_key, purpose });
    const bytes = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        d.keys.privateKey,
        new TextEncoder().encode(`UHM:device-proof:v1:${c.nonce}`),
      ),
    );
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return {
      public_key: d.public_key,
      challenge_id: c.id,
      signature: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    };
  }
  const health = await request('/health');
  check(
    health.mode === 'production' &&
      health.kid === production.license_key_id &&
      health.issuer === production.license_issuer,
    'production identity',
  );
  check(
    JSON.stringify(health.public_key) === JSON.stringify(production.license_public_jwk),
    'pinned public signing key',
  );
  checks.push('Production identity and public trust match');
  const catalog = await request('/catalog');
  check(Array.isArray(catalog.packages), 'real database catalog');
  await request('/admin/overview', undefined, undefined, 401);
  const denied = await fetch(`${production.api_base}/health`, {
    headers: { Origin: 'https://untrusted.invalid' },
  });
  check(
    denied.status === 403 && !denied.headers.has('Access-Control-Allow-Origin'),
    'untrusted CORS origin rejected',
  );
  const preflight = await fetch(`${production.api_base}/device/challenge`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  check(preflight.status === 204, 'browser preflight');
  checks.push('Live catalog, anonymous admin denial, CORS and preflight');
  const direct = await fetch(`${production.supabase_url}/rest/v1/licenses?select=id`, {
    headers: { apikey: production.supabase_publishable_key, 'Accept-Profile': 'uhm' },
  });
  check(
    [401, 403].includes(direct.status),
    `direct browser database access denied (${direct.status})`,
  );
  checks.push('Direct publishable-key access to private schema denied');
  const owner = await device();
  const activation = await request('/licenses/activate', {
    code,
    ...(await proof(owner, 'activate')),
  });
  const { payload } = await jwtVerify(
    activation.grant,
    await importJWK(production.license_public_jwk, 'ES256'),
    {
      issuer: production.license_issuer,
      audience: 'uhm-launcher',
      typ: 'uhm-offline+jwt',
      algorithms: ['ES256'],
    },
  );
  check(
    payload.device_thumbprint === (await calculateJwkThumbprint(owner.public_key)),
    'grant device binding',
  );
  const ownerId = activation.license.id;
  const adminProof = await proof(owner, 'admin');
  const session = await request('/admin/license-session', { license_id: ownerId, ...adminProof });
  check(session.role === 'owner' && session.permissions.length === 17, 'all owner permissions');
  await request('/admin/license-session', { license_id: ownerId, ...adminProof }, undefined, 401);
  const token: string = session.token;
  checks.push('ES256 grant, device binding, owner access and replay protection');
  const created = await request(
    '/admin/licenses',
    { tier: 'normal', count: 1, duration_days: 1 },
    token,
    201,
  );
  const id: string = created.licenses[0].id;
  const code2: string = created.codes[0];
  await request(
    `/admin/licenses/${id}/metadata`,
    {
      display_name: 'Deployment verification — subordinate',
      notes: 'Commissioning only; revoke after tests.',
      tags: ['deployment-test'],
    },
    token,
  );
  const a = await device(),
    b = await device();
  const pa = await proof(a, 'activate'),
    pb = await proof(b, 'activate');
  const attempts = await Promise.all(
    [a, b].map(async (d, i) => {
      const response = await fetch(`${production.api_base}/licenses/activate`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code2, ...[pa, pb][i] }),
        signal: AbortSignal.timeout(20000),
      });
      return { device: d, status: response.status };
    }),
  );
  check(
    attempts.filter((r) => r.status === 200).length === 1 &&
      attempts.filter((r) => r.status === 403).length === 1,
    'atomic one-device activation race',
  );
  const winner = attempts.find((r) => r.status === 200)!.device;
  await request(
    '/admin/license-session',
    { license_id: id, ...(await proof(winner, 'admin')) },
    undefined,
    403,
  );
  await request(
    `/admin/team/${id}`,
    { role: 'viewer', permissions: ['content.read'], enabled: true },
    token,
  );
  const viewer = await request('/admin/license-session', {
    license_id: id,
    ...(await proof(winner, 'admin')),
  });
  const overview = await request('/admin/overview', undefined, viewer.token);
  check(overview.licenses.length === 0, 'viewer cannot read licenses');
  await request('/admin/licenses', { tier: 'vip', count: 1, duration_days: 1 }, viewer.token, 403);
  await request(
    `/admin/team/${id}`,
    { role: 'viewer', permissions: ['content.read'], enabled: false },
    token,
  );
  await request('/admin/overview', undefined, viewer.token, 401);
  checks.push('Issuance, atomic two-device race, delegation and immediate access revocation');
  const event = {
    id: crypto.randomUUID(),
    type: 'app_open',
    occurred_at: new Date().toISOString(),
    session_id: crypto.randomUUID(),
    app_version: '0.1.0',
  };
  for (let i = 0; i < 2; i++)
    await request('/telemetry/batch', {
      license_id: id,
      events: [event],
      ...(await proof(winner, 'telemetry')),
    });
  const activity = await request(`/admin/licenses/${id}/activity`, undefined, token);
  check(
    activity.events.filter((e: any) => e.id === event.id).length === 1,
    'durable upload retry deduplicated',
  );
  const analytics = await request('/admin/analytics?days=30', undefined, token);
  check(
    analytics.totals.some((t: any) => t.type === 'app_open' && Number(t.count) >= 1),
    'real database analytics',
  );
  await request(`/admin/licenses/${id}/suspend`, {}, token);
  await request(
    '/licenses/refresh',
    { license_id: id, ...(await proof(winner, 'refresh')) },
    undefined,
    403,
  );
  await request(`/admin/licenses/${id}/revoke`, {}, token);
  checks.push('Telemetry retry dedupe, live analytics, suspension and revocation');
  return {
    ok: true,
    checks,
    test_license_id: ownerId,
    created_license_id: id,
    verified_at: new Date().toISOString(),
  };
}
