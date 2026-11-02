/** Runs only in the trusted release job. Does not need a repository secret/PAT. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import updater from '../config/updater-public.json';
const broker = 'https://ewjvnqlqacljflvjbpbv.supabase.co/functions/v1/update-key-broker';
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP)
  throw new Error('Hosted release job required');
const oidcUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '');
if (oidcUrl.protocol !== 'https:' || !oidcUrl.hostname.endsWith('.actions.githubusercontent.com'))
  throw new Error('Untrusted OIDC endpoint');
oidcUrl.searchParams.set('audience', broker);
const identity = await fetch(oidcUrl, {
  headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  signal: AbortSignal.timeout(15000),
  redirect: 'error',
});
if (!identity.ok) throw new Error('GitHub OIDC unavailable');
const { value } = (await identity.json()) as { value: string };
if (typeof value !== 'string' || !value) throw new Error('Missing GitHub identity');
console.log(`::add-mask::${value}`);
const response = await fetch(broker, {
  method: 'POST',
  headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ build_run: process.env.BUILD_RUN }),
  signal: AbortSignal.timeout(30000),
  redirect: 'error',
});
if (!response.ok)
  throw new Error(`Signing authorization rejected (${response.status}); no key logged`);
const data = (await response.json()) as { private_key: string; public_key: string };
if (
  data.public_key !== updater.public_key ||
  typeof data.private_key !== 'string' ||
  !/^[A-Za-z0-9+/=]{100,4096}$/.test(data.private_key)
)
  throw new Error('Signing trust mismatch');
console.log(`::add-mask::${data.private_key}`);
await writeFile(join(process.env.RUNNER_TEMP, 'uhm-updater.key'), data.private_key, {
  mode: 0o600,
});
console.log('Ephemeral release signing credential received; never included in artifacts.');
