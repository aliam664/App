import { readFile, writeFile, readdir } from 'node:fs/promises';
for (const file of [
  'index.html',
  ...(await readdir('pages-preview/assets'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => `assets/${f}`),
]) {
  const path = `pages-preview/${file}`;
  const content = await readFile(path, 'utf8');
  await writeFile(
    path,
    content
      .replaceAll('/App/pages-preview/fonts/', '/App/public/fonts/')
      .replaceAll('/App/pages-preview/brand/', '/App/public/brand/'),
  );
}
await writeFile('pages-preview/.nojekyll', '');
await writeFile(
  'pages-preview/build-info.json',
  JSON.stringify(
    {
      revision: process.env.GITHUB_SHA || 'local',
      source: 'index.html + apps/web/src/main.ts',
      mode: process.argv.includes('--live') ? 'connected-production' : 'branch-preview',
    },
    null,
    2,
  ) + '\n',
);
