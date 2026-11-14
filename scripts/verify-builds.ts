import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const desktop = await readFile('dist/index.html', 'utf8');
const pages = await readFile('dist-pages/index.html', 'utf8');
assert.match(desktop, /src="\/assets\//);
assert.match(pages, /src="\/App\/assets\//);
assert.match(pages, /href="\/App\/brand\/icon\.png"/);
const desktopFiles = await readdir('dist/assets');
assert(
  !desktopFiles.some((f) => f.startsWith('static-preview-')),
  'Desktop must not ship the browser demo API.',
);
const desktopJS = (
  await Promise.all(
    desktopFiles.filter((f) => f.endsWith('.js')).map((f) => readFile(`dist/assets/${f}`, 'utf8')),
  )
).join('\n');
assert(!desktopJS.includes('uhm-pages-sandbox'), 'Browser demo issuer leaked into desktop bundle.');
assert.deepEqual(await readFile('dist-pages/404.html'), await readFile('dist-pages/index.html'));
const info = JSON.parse(await readFile('dist-pages/build-info.json', 'utf8'));
assert.equal(info.source, 'index.html + apps/web/src/main.ts');
console.log('Verified shared entry, /App/ assets, fallback and isolated desktop bundle.');
