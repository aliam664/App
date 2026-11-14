import { createApi } from '../../../backend/src/api.ts';
import { SupabaseRepository } from '../../../backend/src/supabase-repository.ts';
function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}
// Base64 is a transport encoding, NOT encryption; both forms are server secrets.
function signingJwk(name: string) {
  const plain = Deno.env.get(name);
  return JSON.parse(plain || atob(required(`${name}_B64`)));
}
const repository = new SupabaseRepository(
  required('SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
);
const api = createApi(repository, {
  mode: 'production',
  offlineLeaseDays: Deno.env.has('UHM_OFFLINE_LEASE_DAYS')
    ? Number(Deno.env.get('UHM_OFFLINE_LEASE_DAYS'))
    : 10,
  privateJwk: signingJwk('LICENSE_SIGNING_JWK'),
  publicJwk: signingJwk('LICENSE_PUBLIC_JWK'),
  pepper: required('LICENSE_PEPPER'),
  kid: required('LICENSE_KEY_ID'),
  issuer: required('LICENSE_ISSUER'),
  allowedOrigins: required('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim()),
});
const TRUSTED_IP_HEADERS = new Set([
  'cf-connecting-ip',
  'fly-client-ip',
  'x-nf-client-connection-ip',
  'x-vercel-forwarded-for',
]);
function resolveTrustedIp(request: Request): string {
  const headerName = (Deno.env.get('TRUSTED_IP_HEADER') || '').trim().toLowerCase();
  if (!headerName || !TRUSTED_IP_HEADERS.has(headerName)) return 'unknown';
  const value = request.headers.get(headerName)?.trim();
  return value && value.length <= 128 ? value : 'unknown';
}
Deno.serve((request) => {
  const url = new URL(request.url);
  url.pathname = `/api${url.pathname.replace(/^\/functions\/v1\/api|^\/api/, '')}`;
  // Never trust raw X-Forwarded-For; accept only an operator-pinned edge IP header or fall back to isolated route buckets.
  return api(new Request(url, request), resolveTrustedIp(request));
});
