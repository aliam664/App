/** Non-destructive production checks; never activates/changes the owner's license. */
import config from '../config/production-public.json';
import { version as appVersion } from '../package.json';
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
    health.version === appVersion &&
    health.kid === config.license_key_id &&
    health.issuer === config.license_issuer,
  'production identity',
);
check(
  JSON.stringify(health.public_key) === JSON.stringify(config.license_public_jwk),
  'unchanged license public trust',
);
check(health.capabilities.includes('content-packages-v2'), 'deployed package v2 capability');
for (const capability of [
  'admin-custom-roles-v1',
  'license-window-v1',
  'package-admin-v1',
  'user-profiles-v1',
])
  check(health.capabilities.includes(capability), `deployed ${capability}`);
checks.push(
  'Matching application version, production identity, unchanged license trust and backward-compatible capabilities',
);
check(Array.isArray((await (await request('/catalog', 200)).json()).packages), 'live catalog');
const contact = await (await request('/contact', 200)).json();
check(
  typeof contact.configured === 'boolean' && typeof contact.contact === 'object',
  'live public contact settings',
);
await request('/admin/overview', 401);
await request('/admin/contact', 401);
for (const operation of ['validate', 'test-plan'])
  await request(`/admin/packages/00000000-0000-4000-8000-000000000000/${operation}`, 401, true);
const denied = await request('/health', 403, false, 'https://untrusted.invalid');
check(!denied.headers.has('Access-Control-Allow-Origin'), 'untrusted origin rejected');
checks.push('Live catalog, public contact and anonymous admin/builder denial; CORS isolation');
for (const table of [
  'licenses',
  'package_files',
  'package_steps',
  'package_dependencies',
  'custom_roles',
  'package_categories',
  'contact_settings',
]) {
  const response = await fetch(`${config.supabase_url}/rest/v1/${table}?select=*`, {
    headers: { apikey: config.supabase_publishable_key, 'Accept-Profile': 'uhm' },
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  check([401, 403, 404, 406].includes(response.status), `anonymous direct ${table} access denied`);
}
checks.push(
  'Anonymous database access to licenses and normalized content and new admin tables denied',
);
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
