/* اسموک تست فرانت‌اند: بارگذاری اسکریپت‌ها و رندر صفحات با DOM شبیه‌سازی‌شده */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');

function loadScript(context, file) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  const fn = new Function('window', 'document', 'requestAnimationFrame', code);
  fn.call(context, context.window, context.document, (cb) => cb());
}

async function bootstrap() {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const { window, document } = parseHTML(html);
  const ctx = { window, document, requestAnimationFrame: (cb) => cb() };

  // شبیه‌سازی preload bridge
  const state = {
    settings: { language: 'fa', theme: 'night', gamePath: '/fake/game' },
    manifest: { appVersion: '1.0.0', systemTier: null, lastInstallDate: null, mods: {} },
    installProgress: null
  };
  window.uhm = {
    windowMinimize() {}, windowToggleMaximize() {}, windowClose() {},
    getSettings: async () => state.settings,
    setSettings: async (p) => Object.assign(state.settings, p),
    getManifest: async () => state.manifest,
    saveManifest: async (m) => { state.manifest = m; },
    browseGamePath: async () => '/fake/game',
    validateGamePath: async () => ({ valid: true }),
    autoDetectGamePath: async () => '/fake/game',
    checkBaseMods: async () => ({ csp: { found: true }, pure: { found: false } }),
    copyWithBackup: async () => ({ success: true }),
    restoreOrDelete: async () => ({ status: 'deleted' }),
    pathExists: async () => true,
    getLocalAppData: async () => 'C:\\AppData',
    detectSystemSpecs: async () => ({ platform: 'win32', osVersion: '10', cpuName: 'i7', cpuCores: 12, totalMemGb: 32, gpuName: 'NVIDIA GeForce RTX 3060', gpuVramGb: 12, driverVersion: 'x', suggestedTier: 'ultra', detectedBy: 'gpu' }),
    suggestTier: async () => ({ tier: 'ultra', detectedBy: 'gpu' }),
    runInstall: async (plan) => ({ success: true, mods: plan.mods.map((m) => ({ ...m, status: 'installed', installedFiles: [{ dest: '/x', backupPath: null }] })) }),
    cancelInstall: async () => true,
    runUninstall: async () => [],
    listModAssets: async () => ['csp', 'pure'],
    onInstallProgress: () => () => {},
    openExternal: () => {},
    scanLibrary: async () => ({
      cars: [{
        type: 'car', id: 'car:ks_ferrari_fxxk', folder: 'ks_ferrari_fxxk', name: 'Ferrari FXX K',
        brand: 'Ferrari', klass: 'Race', country: 'Italy', year: '2014', specs: { power: '860' },
        preview: 'content/cars/ks_ferrari_fxxk/ui/preview.png', hasPreview: true,
        isKunos: true, isMod: false, isDlc: false, origin: 'kunos',
        skinCount: 2, skins: ['red'], layoutCount: 0, layouts: [],
        sizeBytes: 100, fileCount: 2, modifiedAt: '2024-01-01', hasUi: true
      }],
      tracks: []
    }),
    getContentPreview: async () => null,
    deleteContent: async () => ({ success: true }),
    restoreContent: async () => ({ success: true }),
    purgeContent: async () => ({ success: true }),
    emptyTrash: async () => ({ success: true }),
    listTrash: async () => [],
    getPreviewCandidates: async () => []
  };

  // بارگذاری اسکریپت‌ها (به همان ترتیب index.html)
  const files = [
    'src/js/i18n.js',
    'src/js/utils.js',
    'src/js/modConfig.js',
    'src/js/app.js',
    'src/pages/showcase.js',
    'src/pages/settings.js',
    'src/pages/about.js',
    'src/pages/gamePath.js',
    'src/pages/baseModsCheck.js',
    'src/pages/tierSelect.js',
    'src/pages/install.js',
    'src/pages/done.js',
    'src/pages/manageMods.js',
    'src/js/libraryData.js',
    'src/pages/library.js'
  ];
  for (const f of files) loadScript(ctx, f);

  // bootstrap
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 30));

  const container = document.getElementById('page-content');
  assert.ok(container.innerHTML.includes('UHM PACK'), 'showcase should render');
  assert.ok(container.innerHTML.includes('btn-settings-home'), 'home should have settings button');
  assert.ok(container.innerHTML.includes('btn-about'), 'home should have about button');
  assert.ok(container.innerHTML.includes('btn-start-install'), 'home should have start install');
  assert.ok(container.innerHTML.includes('Custom Shaders Patch'), 'home should show mods list');

  // ناوبری به تنظیمات
  window.navigate('settings');
  assert.ok(container.innerHTML.includes('تنظیمات'), 'settings should render');

  window.navigate('about');
  assert.ok(container.innerHTML.includes('درباره'), 'about should render');

  window.navigate('gamePath');
  assert.ok(container.innerHTML.includes('auto-detect') || container.innerHTML.includes('جستجوی خودکار'), 'gamePath should render');

  window.navigate('baseModsCheck');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(container.innerHTML.includes('CSP'), 'baseModsCheck should render');

  window.navigate('tierSelect');
  assert.ok(container.innerHTML.includes('شروع نصب') || container.innerHTML.includes('low'), 'tierSelect should render');

  // == Content Library page ==
  window.navigate('library');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(container.innerHTML.includes('کتابخانه'), 'library should render title');
  assert.ok(container.innerHTML.includes('library-stats'), 'library should render stats');
  assert.ok(container.innerHTML.includes('library-tabs'), 'library should render tabs');
  assert.ok(container.innerHTML.includes('library-search'), 'library should render search');
  assert.ok(container.innerHTML.includes('Ferrari FXX K'), 'library should render scanned car');

  const plan = {
    tier: 'ultra', gamePath: '/fake/game',
    mods: [{ id: 'csp', dest: '', type: 'copy', overwrite: true }]
  };
  window.navigate('install', { plan });
  assert.ok(container.innerHTML.includes('CSP'), 'install should render');
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(container.innerHTML.includes('نصب'), 'install should complete to done');

  // == تست mock پیش‌نمایش مرورگر (npm run serve) ==
  const { window: pw, document: pd } = parseHTML('<!DOCTYPE html><body></body>');
  pw.localStorage = { getItem: () => null, setItem: () => {} };
  loadScript({ window: pw, document: pd }, 'src/js/browser-preview.js');
  assert.ok(pw.uhm, 'browser preview should define window.uhm when absent');
  const pv = await pw.uhm.runInstall({ tier: 'high', mods: [{ id: 'csp' }] });
  assert.strictEqual(pv.success, true);
  assert.strictEqual(pv.mods.length, 1);

  console.log('RENDERER TESTS PASSED');
}

bootstrap().catch((e) => { console.error('RENDERER TEST FAILED', e); process.exit(1); });
