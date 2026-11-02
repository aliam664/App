/**
 * GitHub Pages has no server. This browser-local sandbox reuses the SAME demo API
 * and repository as development. Its runtime-generated keys are demo keys only;
 * they cannot authorize the production server or the Windows installer.
 */
import { exportJWK, generateKeyPair } from 'jose';
import { createApi, type ApiConfig } from '../../../backend/src/api';
import { LocalRepository, emptyState, type State } from '../../../backend/dev/store';
import { seedPackages } from '../../../backend/src/seed';
import { b64 } from '../../../backend/src/crypto';
import { localStore } from './storage';

export async function createStaticPreview() {
  type Sandbox = {
    state: State;
    keys: Pick<ApiConfig, 'privateJwk' | 'publicJwk' | 'pepper'>;
    token: string;
  };
  let sandbox: Sandbox | null = null;
  try {
    sandbox = JSON.parse(localStore.getItem('sandbox-v1') || 'null');
  } catch {
    /* Reset corrupt demo data. */
  }
  if (!sandbox?.state || !sandbox.keys?.privateJwk || !sandbox.token) {
    const pair = await generateKeyPair('ES256', { extractable: true });
    const state = emptyState();
    state.packages = seedPackages();
    sandbox = {
      state,
      keys: {
        privateJwk: await exportJWK(pair.privateKey),
        publicJwk: await exportJWK(pair.publicKey),
        pepper: b64(crypto.getRandomValues(new Uint8Array(32))),
      },
      token: b64(crypto.getRandomValues(new Uint8Array(32))),
    };
  }
  const data = sandbox;
  const save = () => localStore.setItem('sandbox-v1', JSON.stringify(data));
  save();
  const repo = new LocalRepository(
    data.state,
    async (state) => {
      data.state = state;
      save();
    },
    data.token,
  );
  const handler = createApi(repo, {
    ...data.keys,
    mode: 'demo',
    issuer: 'uhm-pages-sandbox',
    kid: 'pages-demo-v1',
    allowedOrigins: [],
    demoSession: { token: data.token, license: 'DEMO-USE-FRESH-LICENSE-ENDPOINT' },
  });
  return (path: string, body?: unknown, token?: string) =>
    handler(
      new Request(`https://pages-sandbox.invalid/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      'browser-local-demo',
    );
}
