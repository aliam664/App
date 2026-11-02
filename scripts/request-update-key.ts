/** Runs only in the trusted release job. Does not need a repository secret/PAT. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import updater from '../config/updater-public.json';
import { assertReleaseIdentity } from '../backend/src/update-key-broker';
// Explicit safe annotations are available even when the runner log archive is unavailable.
process.on('uncaughtException', (error: Error) => {
  const safe =
    /^(Hosted release job required|Untrusted OIDC endpoint|GitHub OIDC unavailable|Missing GitHub identity|Release identity rejected|Signing trust mismatch|Signing authorization rejected \(\d{3}\); no key logged)$/.test(
      error.message,
    )
      ? error.message
      : 'Release authorization failed; request and credential data were not logged';
  console.error(`::error title=Release authorization::${safe}`);
  process.exit(1);
});
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
const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
const publicMetadata = Object.fromEntries(
  [
    'iss',
    'aud',
    'repository',
    'repository_id',
    'ref',
    'ref_type',
    'workflow_ref',
    'runner_environment',
    'event_name',
    'sha',
    'sub',
    'run_id',
    'iat',
    'exp',
  ].map((name) => [name, claims[name]]),
);
console.log(
  `::notice title=Public OIDC claims only::${JSON.stringify(publicMetadata).replaceAll('%', '%25')}`,
);
// This is a policy preflight only; the cloud still independently verifies the RS256 signature.
assertReleaseIdentity(claims);
if (process.env.UHM_OIDC_PROBE === 'true') {
  // Invalid build syntax is rejected only AFTER RS256 and identity policy verification.
  // It cannot issue or consume a signing credential, even before a build has completed.
  const probe = await fetch(broker, {
    method: 'POST',
    headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ build_run: 'invalid' }),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (probe.status !== 400)
    throw Error(`Signing authorization rejected (${probe.status}); no key logged`);
  console.log(
    '::notice title=OIDC policy::Cloud RS256 identity validated; invalid build rejected before credential issuance.',
  );
  process.exit(0);
}
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
