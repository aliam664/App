/** Only public, versioned trust material. Never put server credentials in this file. */
import { appendFile } from 'node:fs/promises';
import config from '../config/production-public.json';
if (!process.env.GITHUB_ENV) throw new Error('Run this helper inside GitHub Actions.');
if ('d' in config.license_public_jwk)
  throw new Error('Private signing key in public configuration!');
const values = {
  VITE_API_BASE: config.api_base,
  VITE_SUPABASE_URL: config.supabase_url,
  VITE_SUPABASE_PUBLISHABLE_KEY: config.supabase_publishable_key,
  UHM_LICENSE_PUBLIC_JWK: JSON.stringify(config.license_public_jwk),
  UHM_LICENSE_ISSUER: config.license_issuer,
  UHM_LICENSE_KEY_ID: config.license_key_id,
};
await appendFile(
  process.env.GITHUB_ENV,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}\n`)
    .join(''),
);
console.log('Loaded six PUBLIC production settings from versioned configuration.');
