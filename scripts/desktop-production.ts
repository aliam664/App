import { spawnSync } from 'node:child_process';
import config from '../config/production-public.json';
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tauri', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_API_BASE: config.api_base,
    VITE_SUPABASE_URL: config.supabase_url,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.supabase_publishable_key,
    UHM_LICENSE_PUBLIC_JWK: JSON.stringify(config.license_public_jwk),
    UHM_LICENSE_ISSUER: config.license_issuer,
    UHM_LICENSE_KEY_ID: config.license_key_id,
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
