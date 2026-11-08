import { copyFile, writeFile, readFile } from 'node:fs/promises';
// Vite compiled the single root index and the same UI entry used by desktop.
const entry = await readFile('dist-pages/index.html', 'utf8');
if (
  !entry.includes('type="module"') ||
  /<script[^>]+src=["']\/apps\/web\/src\/main\.ts/.test(entry)
) {
  throw new Error(
    'Pages artifact must contain compiled JavaScript, not the TypeScript source entry.',
  );
}
await copyFile('dist-pages/index.html', 'dist-pages/404.html');
await writeFile('dist-pages/.nojekyll', '');
await writeFile(
  'dist-pages/build-info.json',
  JSON.stringify(
    {
      revision: process.env.GITHUB_SHA || 'local',
      source: 'index.html + apps/web/src/main.ts',
      mode: process.argv.includes('--live') ? 'connected-production' : 'browser-local-preview',
      built_at: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
