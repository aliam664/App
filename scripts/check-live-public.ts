/** Non-destructive production checks; never activates/changes the owner's license. */
import config from '../config/production-public.json';
import { BROKER_URL } from '../backend/src/update-key-broker';
const checks: string[] = [];
const origin = 'https://aliam664.github.io';
function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw Error(`Live check failed: ${label}`);
}
async function request(path: string, expected: number, post = false, requestOrigin = origin) {
  const response = await fetch(`${config.api_base}${path}`, {
    method: post ? 'POST' : 'GET',
    headers: { Origin: requestOrigin, ...(post ? { 'Content-Type': 'application/json' } : {}) },
    body: post ? '{}' : undefined,
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  check(response.status === expected, `${path}: HTTP ${response.status}, expected ${expected}`);
  if (requestOrigin === origin)
    check(response.headers.get('Access-Control-Allow-Origin') === origin, 'approved origin CORS');
  return response;
}
const health = await (await request('/health', 200)).json();
check(
  health.mode === 'production' &&
    health.kid === config.license_key_id &&
    health.issuer === config.license_issuer,
  'production identity',
);
check(
  JSON.stringify(health.public_key) === JSON.stringify(config.license_public_jwk),
  'unchanged license public trust',
);
check(health.capabilities.includes('content-packages-v2'), 'deployed package v2 capability');
checks.push('Production identity, unchanged license trust and live package v2 capability');
check(Array.isArray((await (await request('/catalog', 200)).json()).packages), 'live catalog');
await request('/admin/overview', 401);
for (const operation of ['validate', 'test-plan'])
  await request(`/admin/packages/00000000-0000-4000-8000-000000000000/${operation}`, 401, true);
const denied = await request('/health', 403, false, 'https://untrusted.invalid');
check(!denied.headers.has('Access-Control-Allow-Origin'), 'untrusted origin rejected');
checks.push('Live catalog and anonymous admin/builder denial; CORS isolation');
for (const table of ['licenses', 'package_files', 'package_steps', 'package_dependencies']) {
  const response = await fetch(`${config.supabase_url}/rest/v1/${table}?select=*`, {
    headers: { apikey: config.supabase_publishable_key, 'Accept-Profile': 'uhm' },
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  check([401, 403, 404, 406].includes(response.status), `anonymous direct ${table} access denied`);
}
checks.push('Anonymous database access to licenses and all three new normalized tables denied');
const brokerGet = await fetch(BROKER_URL, { signal: AbortSignal.timeout(25000) });
check(brokerGet.status === 405, 'broker GET denied');
const brokerAnonymous = await fetch(BROKER_URL, {
  method: 'POST',
  body: '{}',
  signal: AbortSignal.timeout(25000),
});
check(
  brokerAnonymous.status === 401 && !brokerAnonymous.headers.has('Access-Control-Allow-Origin'),
  'anonymous signing credential access denied',
);
checks.push('Live cloud key broker rejects GET and anonymous POST without exposing secrets');
console.log(JSON.stringify({ ok: true, checks }, null, 2));
