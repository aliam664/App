/* بررسی سلامت پروژه: syntax + تست فرانت‌اند + فایل‌های ضروری (Tauri) */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [
  'src/js/tauri-bridge.js',
  'src/js/i18n.js', 'src/js/ui.js', 'src/js/utils.js', 'src/js/modConfig.js', 'src/js/app.js',
  'src/js/browser-preview.js', 'src/js/libraryData.js',
  'src/pages/showcase.js', 'src/pages/settings.js', 'src/pages/about.js',
  'src/pages/gamePath.js', 'src/pages/baseModsCheck.js', 'src/pages/tierSelect.js',
  'src/pages/install.js', 'src/pages/done.js', 'src/pages/manageMods.js', 'src/pages/addons.js',
  'src/pages/library.js',
  'src/pages/modInstall.js',
  'src/pages/donate.js',
  'test/renderer.test.js',
  'test/libraryData.test.js',
  'test/i18n.test.js'
];

let ok = true;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('MISSING FILE:', f); ok = false; continue; }
  try {
    execSync(`node --check ${f}`, { stdio: 'pipe' });
  } catch (e) {
    console.log('SYNTAX ERROR:', f, '\n', e.stderr.toString());
    ok = false;
  }
}

const requiredAssets = [
  'src-tauri/icons/icon.ico',
  'src-tauri/icons/icon.png',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/src/lib.rs',
  'src/assets/images/tiers/low.webp',
  'src/assets/images/tiers/medium.webp',
  'src/assets/images/tiers/high.webp',
  'src/assets/images/tiers/veryhigh.webp',
  'src/assets/images/tiers/ultra.webp',
  'src/assets/images/logo.webp',
  'src/assets/images/backgrounds/day.webp',
  'src/assets/images/backgrounds/night.webp',
  'src/assets/fonts/Vazirmatn-Regular.woff2',
  'src/assets/fonts/Vazirmatn-Medium.woff2',
  'src/assets/fonts/Vazirmatn-Bold.woff2',
  'src/assets/fonts/Vazirmatn-ExtraBold.woff2',
  'src/assets/fonts/Vazirmatn-Black.woff2'
];
for (const a of requiredAssets) {
  if (!fs.existsSync(a)) { console.log('MISSING ASSET:', a); ok = false; }
}

if (ok) {
  console.log('✔ Syntax & assets OK');
  // Backend logic (installer / library / hardware / mod installer) now lives
  // in Rust and is covered by `cargo test` (see src-tauri/src/*.rs).
  for (const t of [
    'node test/renderer.test.js',
    'node test/libraryData.test.js',
    'node test/i18n.test.js'
  ]) {
    try {
      execSync(t, { stdio: 'inherit' });
    } catch (e) {
      ok = false;
    }
  }
}
if (!ok) process.exit(1);
