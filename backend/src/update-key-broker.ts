/** Short-lived GitHub OIDC authorization, never a public secret retrieval API. */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import updater from '../../config/updater-public.json';
export const BROKER_URL = 'https://ewjvnqlqacljflvjbpbv.supabase.co/functions/v1/update-key-broker';
export const RELEASE_REFS = ['refs/heads/main', 'refs/heads/arena/0b78cac4-app'] as const;
export const RELEASE_WORKFLOW =
  'aliam664/App/.github/workflows/release-launcher.yml@refs/heads/main';
const githubKeys = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
  { timeoutDuration: 8000 },
);
export function assertReleaseIdentity(claims: JWTPayload) {
  for (const [key, value] of Object.entries({
    repository_id: '1363261683',
    repository_owner_id: '259944690',
    repository: 'aliam664/App',
    ref_type: 'branch',
    runner_environment: 'github-hosted',
  })) {
    if (claims[key] !== value) throw new Error('Release identity rejected');
  }
  const ref = claims.ref as string;
  if (
    !RELEASE_REFS.includes(ref as (typeof RELEASE_REFS)[number]) ||
    claims.workflow_ref !== `aliam664/App/.github/workflows/release-launcher.yml@${ref}` ||
    !['workflow_dispatch', 'push'].includes(claims.event_name as string) ||
    typeof claims.sha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(claims.sha) ||
    typeof claims.run_id !== 'string' ||
    !/^\d{1,20}$/.test(claims.run_id) ||
    ![`repo:aliam664@259944690/App@1363261683:ref:${ref}`, `repo:aliam664/App:ref:${ref}`].includes(
      claims.sub ?? '',
    ) ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 600
  )
    throw new Error('Release identity rejected');
}
export async function verifyReleaseIdentity(token: string, keys: JWTVerifyGetKey = githubKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://token.actions.githubusercontent.com',
    audience: BROKER_URL,
    algorithms: ['RS256'],
    requiredClaims: ['iat', 'exp', 'sub'],
    maxTokenAge: '120s',
    clockTolerance: 5,
  });
  assertReleaseIdentity(payload);
  return payload;
}
async function github(path: string) {
  const response = await fetch(`https://api.github.com/repos/aliam664/App/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UHM-release-key-broker' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Build provenance unavailable');
  return response.json();
}
export async function verifyBuild(runId: string, releaseSha: string) {
  const run = await github(`actions/runs/${runId}`);
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/quality.yml' ||
    !RELEASE_REFS.includes(`refs/heads/${run.head_branch}` as (typeof RELEASE_REFS)[number]) ||
    run.event !== 'push' ||
    run.repository?.id !== 1363261683 ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  )
    throw new Error('Build provenance rejected');
  if (run.head_sha !== releaseSha) {
    // Pages bot/documentation merges may follow a green build. Executable or CI changes may not.
    const comparison = await github(`compare/${run.head_sha}...${releaseSha}`);
    if (
      !['ahead', 'identical'].includes(comparison.status) ||
      !Array.isArray(comparison.files) ||
      comparison.files.length >= 300 ||
      comparison.files.some((file: { filename: string; previous_filename?: string }) =>
        [file.filename, file.previous_filename]
          .filter(Boolean)
          .some(
            (name) =>
              !/^(docs\/|pages-preview\/|README\.md$|\.github\/release-request\.json$)/.test(name!),
          ),
      )
    )
      throw new Error('Application changed since verified build');
  }
}
type Dependencies = {
  privateKey: () => string | undefined;
  verifyIdentity?: typeof verifyReleaseIdentity;
  verifyBuild?: typeof verifyBuild;
};
export function createUpdateKeyBroker(deps: Dependencies) {
  const used = new Map<string, number>();
  return async (request: Request) => {
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      });
    if (request.method !== 'POST') return reply({ error: 'POST required' }, 405);
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ') || auth.length > 20000)
      return reply({ error: 'Unauthorized' }, 401);
    let claims: JWTPayload;
    try {
      claims = await (deps.verifyIdentity ?? verifyReleaseIdentity)(auth.slice(7));
      // Keep the checks even when the verifier is injected in a test.
      assertReleaseIdentity(claims);
    } catch {
      return reply({ error: 'Unauthorized' }, 401);
    }
    let buildRun: string;
    try {
      // Read a bounded body; Content-Length is not trusted.
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      let size = 0,
        body = '';
      const decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1024) {
          await reader.cancel();
          throw new Error();
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      buildRun = JSON.parse(body).build_run;
      if (typeof buildRun !== 'string' || !/^\d{1,20}$/.test(buildRun)) throw new Error();
    } catch {
      return reply({ error: 'Invalid request' }, 400);
    }
    const now = Date.now();
    for (const [key, until] of used) if (until < now) used.delete(key);
    const identity = `${claims.run_id}:${claims.run_attempt}:${claims.jti ?? ''}`;
    if (used.has(identity))
      return reply({ error: 'Credential already issued; request a fresh job' }, 409);
    try {
      await (deps.verifyBuild ?? verifyBuild)(buildRun, claims.sha as string);
    } catch {
      return reply({ error: 'Verified build required' }, 409);
    }
    const key = deps.privateKey();
    if (!key || key.length > 4096) return reply({ error: 'Signing unavailable' }, 503);
    if (used.size > 1000) return reply({ error: 'Retry later' }, 503);
    used.set(identity, now + 600000);
    // This response goes only to the authorized hosted release job, over TLS, not to the app.
    // Never add CORS, print this value, or return it from a health endpoint.
    return reply({ private_key: key, public_key: updater.public_key });
  };
}
