#!/usr/bin/env node
/*
 * Mirrors `src/` (the exact HTML/CSS/JS/fonts/images bundled into the app by
 * Tauri) into `view/` so anyone can double-click `view/index.html` and see
 * the real UI in Chrome — no build, no server.
 *
 *   node scripts/sync-view.js          # regenerate view/
 *   node scripts/sync-view.js --check  # exit 1 if view/ is out of date (CI)
 *
 * view/ is a byte-for-byte copy: never edit files there by hand.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const OUT = path.join(root, 'view');
const check = process.argv.includes('--check');

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc);
    else acc.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return acc.sort();
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const srcFiles = walk(SRC);
const README = `# view/ — the app's real UI, openable in a browser

This folder is an exact, generated mirror of \`src/\` — the HTML, CSS,
JavaScript, fonts and images that Tauri bundles into the Windows app.
Nothing here is simplified or re-styled.

**To view:** double-click \`index.html\` (Chrome / Edge). The backend is
simulated by \`js/browser-preview.js\`, so install actions are demo-only.
Toggle theme/language from the title bar; \`Ctrl+Shift+R\` reloads styles.

**Do not edit files here.** Edit \`src/\` and run \`npm run view\` — CI fails
if \`view/\` drifts from \`src/\` (\`node scripts/sync-view.js --check\`).

Design tokens and rules: \`../docs/DESIGN.md\`.
`;

if (check) {
  const outFiles = fs.existsSync(OUT) ? walk(OUT).filter((f) => f !== 'README.md') : [];
  const bad = [];
  for (const f of srcFiles) {
    const a = path.join(SRC, f), b = path.join(OUT, f);
    if (!fs.existsSync(b) || sha(a) !== sha(b)) bad.push('changed: ' + f);
  }
  for (const f of outFiles) if (!srcFiles.includes(f)) bad.push('stale:   ' + f);
  if (bad.length) { console.error('view/ is out of date:\n  ' + bad.join('\n  ') + '\nRun: npm run view'); process.exit(1); }
  console.log(`✔ view/ matches src/ (${srcFiles.length} files)`);
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of srcFiles) {
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), dst);
}
fs.writeFileSync(path.join(OUT, 'README.md'), README);
console.log(`✔ view/ regenerated (${srcFiles.length} files)`);
