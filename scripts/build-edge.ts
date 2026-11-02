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

// The body-only cloud connector cannot package relative/HTTPS imports. Flatten only
// application modules; Deno resolves these three exact npm versions itself.
const npmImports: Record<string, string> = {
  zod: 'npm:zod@4.6.7',
  jose: 'npm:jose@6.2.14',
  '@supabase/supabase-js': 'npm:@supabase/supabase-js@2.118.0',
};
async function cloudEntry(source: string, output: string, suffix = '') {
  const result = await build({
    entryPoints: [source],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: source !== 'scripts/live-smoke.ts',
    legalComments: 'eof',
    write: false,
    external: Object.keys(npmImports),
  });
  let text = result.outputFiles[0].text;
  for (const [name, specifier] of Object.entries(npmImports)) {
    text = text.replaceAll(`from"${name}"`, `from"${specifier}"`);
  }
  await writeFile(output, text + suffix);
  return {
    sha256: createHash('sha256')
      .update(text + suffix)
      .digest('hex'),
    bytes: Buffer.byteLength(text + suffix),
  };
}
const api = await cloudEntry('supabase/functions/api/index.ts', 'deployment/edge/api.js');
await writeFile(
  'deployment/edge/cloud-integrity.json',
  JSON.stringify({ api, npm: npmImports }, null, 2) + '\n',
);
// Test export only; temporary cloud runners must be removed after commissioning.
await cloudEntry('supabase/functions/commissioning/index.ts', 'deployment/edge/commissioning.js');
