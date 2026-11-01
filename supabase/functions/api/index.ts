import { createApi } from '../../../backend/src/api.ts';
import { SupabaseRepository } from '../../../backend/src/supabase-repository.ts';
function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}
const repository = new SupabaseRepository(
  required('SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
);
const api = createApi(repository, {
  mode: 'production',
  privateJwk: JSON.parse(required('LICENSE_SIGNING_JWK')),
  publicJwk: JSON.parse(required('LICENSE_PUBLIC_JWK')),
  pepper: required('LICENSE_PEPPER'),
  kid: required('LICENSE_KEY_ID'),
  issuer: required('LICENSE_ISSUER'),
  allowedOrigins: required('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim()),
});
Deno.serve((request) => {
  const url = new URL(request.url);
  url.pathname = `/api${url.pathname.replace(/^\/functions\/v1\/api|^\/api/, '')}`;
  // Conservative shared rate bucket. Add a trusted ingress IP adapter before large public rollout.
  return api(new Request(url, request), 'unknown');
});
