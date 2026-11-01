import { SignJWT, jwtVerify, importJWK, calculateJwkThumbprint, type JWK } from 'jose';
import type { License } from '../../packages/contracts/src/index.ts';
export const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
export const unb64 = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
export async function codeHash(code: string, pepper: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code.trim().toUpperCase())),
    ),
  );
}
export const thumbprint = (jwk: JWK) => calculateJwkThumbprint(jwk, 'sha256');
export async function verifyProof(jwk: JWK, signature: string, nonce: string) {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64(signature),
      new TextEncoder().encode(`UHM:device-proof:v1:${nonce}`),
    );
  } catch {
    return false;
  }
}
export type SigningConfig = {
  privateJwk: JWK;
  publicJwk: JWK;
  pepper: string;
  issuer: string;
  kid: string;
};
export async function signPayload(
  payload: Record<string, unknown>,
  config: SigningConfig,
  kind: string,
  ttl: number,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: kind, kid: config.kid })
    .setIssuer(config.issuer)
    .setAudience('uhm-launcher')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .setJti(crypto.randomUUID())
    .sign(await importJWK(config.privateJwk, 'ES256'));
}
export async function verifyToken(token: string, config: SigningConfig, kind: string) {
  const { payload, protectedHeader } = await jwtVerify(
    token,
    await importJWK(config.publicJwk, 'ES256'),
    { algorithms: ['ES256'], issuer: config.issuer, audience: 'uhm-launcher', typ: kind },
  );
  if (protectedHeader.kid !== config.kid) throw new Error('INVALID_KEY');
  return payload;
}
export async function grant(license: License, config: SigningConfig) {
  const now = Date.now(),
    end = Math.min(now + 10 * 86400000, Date.parse(license.expires_at!));
  return signPayload(
    {
      license_id: license.id,
      device_thumbprint: license.device_thumbprint,
      tier: license.tier,
      entitlement_version: license.entitlement_version,
      refresh_after: Math.min(now + 3 * 86400000, end),
      offline_until: end,
      schema_version: 1,
    },
    config,
    'uhm-offline+jwt',
    Math.max(1, Math.floor((end - now) / 1000)),
  );
}
