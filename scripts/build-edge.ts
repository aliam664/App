/** Reproducible, secret-free bundle for a commit-pinned Edge deployment. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
await build({
  entryPoints: ['supabase/functions/api/index.ts'],
  outfile: 'deployment/edge/runtime.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const data = await readFile('deployment/edge/runtime.js');
await writeFile(
  'deployment/edge/integrity.json',
  JSON.stringify(
    { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length },
    null,
    2,
  ) + '\n',
);
console.log(`Bundled Edge runtime (${data.length} bytes); no environment values embedded.`);

await build({
  entryPoints: ['scripts/live-smoke.ts'],
  outfile: 'deployment/edge/smoke.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
