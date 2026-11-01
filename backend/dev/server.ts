// Explicit local/demo adapter. NEVER deploy this server as a production license service.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { exportJWK, generateKeyPair } from 'jose';
import { LocalRepository, emptyState, type State } from './store.ts';
import { createApi, type ApiConfig } from '../src/api.ts';
import { seedPackages } from '../src/seed.ts';
import { codeHash, b64, generateLicenseCode } from '../src/crypto.ts';
if (process.env.NODE_ENV === 'production')
  throw new Error('Demo server is disabled in production. Deploy the Supabase function.');
await mkdir('.local', { recursive: true, mode: 0o700 });
let keys: Pick<ApiConfig, 'privateJwk' | 'publicJwk' | 'pepper'>;
try {
  keys = JSON.parse(await readFile('.local/dev-keys.json', 'utf8'));
} catch {
  const pair = await generateKeyPair('ES256', { extractable: true });
  keys = {
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
    pepper: b64(crypto.getRandomValues(new Uint8Array(32))),
  };
  await writeFile('.local/dev-keys.json', JSON.stringify(keys), { mode: 0o600 });
}
let state: State;
try {
  state = JSON.parse(await readFile('.local/state.json', 'utf8'));
} catch {
  state = emptyState();
  state.packages = seedPackages();
}
const token = b64(crypto.getRandomValues(new Uint8Array(32)));
const demoCode = generateLicenseCode();
const repo = new LocalRepository(
  state,
  async (state) => {
    await writeFile('.local/state.tmp', JSON.stringify(state), { mode: 0o600 });
    await rename('.local/state.tmp', '.local/state.json');
  },
  token,
);
await repo.insert('licenses', [
  {
    id: crypto.randomUUID(),
    code_hash: await codeHash(demoCode, keys.pepper),
    prefix: demoCode.slice(0, 9),
    tier: 'pro',
    status: 'unused',
    duration_days: 30,
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    device_thumbprint: null,
    entitlement_version: 1,
    activation_count: 0,
  },
]);
const api = createApi(repo, {
  ...keys,
  mode: 'demo',
  issuer: 'uhm-local',
  kid: 'local-v1',
  allowedOrigins: [],
  demoSession: { token, license: demoCode },
});
const port = Number(process.env.PORT || 5173);
const vite = await createViteServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true, hmr: { port: 24678, host: '0.0.0.0' } },
  appType: 'spa',
});
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    try {
      // Same-origin only. Proxy forwarded-origin headers are NOT used for authentication or rate-limit identity.
      const bytes: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 131072) {
          res.writeHead(413);
          res.end();
          return;
        }
        bytes.push(c);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      // Demo preview supports its actual request origin; production uses a fixed allowlist.
      headers.delete('origin');
      const request = new Request(`http://dev.local${req.url}`, {
        method: req.method,
        headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(bytes) } : {}),
      });
      const result = await api(request, req.socket.remoteAddress || 'unknown');
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end('{"error":"DEV_ADAPTER_ERROR"}');
    }
  } else {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    vite.middlewares(req, res);
  }
});
server.listen(port, '0.0.0.0', () =>
  console.log(
    `UHM demo ready on 0.0.0.0:${port}. Demo data only; no Windows file operations in the browser.`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    void vite.close().then(() => process.exit());
  });
