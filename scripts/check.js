/* بررسی سلامت پروژه: syntax + تست + فایل‌های ضروری */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [
  'main.js', 'preload.js',
  'src/js/i18n.js', 'src/js/ui.js', 'src/js/utils.js', 'src/js/modConfig.js', 'src/js/app.js',
  'src/js/browser-preview.js', 'src/js/libraryData.js',
  'src/pages/showcase.js', 'src/pages/settings.js', 'src/pages/about.js',
  'src/pages/gamePath.js', 'src/pages/baseModsCheck.js', 'src/pages/tierSelect.js',
  'src/pages/install.js', 'src/pages/done.js', 'src/pages/manageMods.js',
  'src/pages/library.js',
  'src/pages/modInstall.js',
  'src/lib/installer.js',
  'src/lib/hardware.js',
  'src/lib/library.js',
  'src/lib/modInstaller.js',
  'test/installer.test.js',
  'test/hardware.test.js',
  'test/renderer.test.js',
  'test/library.test.js',
  'test/libraryData.test.js',
  'test/modInstaller.test.js'
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
  'src/assets/images/icon.ico',
  'src/assets/images/icon.png',
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
  for (const t of [
    'node test/installer.test.js',
    'node test/hardware.test.js',
    'node test/renderer.test.js',
    'node test/library.test.js',
    'node test/libraryData.test.js',
    'node test/modInstaller.test.js'
  ]) {
    try {
      execSync(t, { stdio: 'inherit' });
    } catch (e) {
      ok = false;
    }
  }
}
if (!ok) process.exit(1);
