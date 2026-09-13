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
    checkBaseMods: async () => ({ csp: { found: true, markers: ['/fake/game/extension/config/data_manifest.ini'] }, pure: { found: false, markers: [] } }),
    copyWithBackup: async () => ({ success: true }),
    restoreOrDelete: async () => ({ status: 'deleted' }),
    pathExists: async () => true,
    getLocalAppData: async () => 'C:\\AppData',
    detectSystemSpecs: async () => ({ platform: 'win32', osVersion: '10', cpuName: 'i7', cpuCores: 12, totalMemGb: 32, gpuName: 'NVIDIA GeForce RTX 3060', gpuVramGb: 12, driverVersion: 'x', suggestedTier: 'ultra', detectedBy: 'gpu' }),
    suggestTier: async () => ({ tier: 'ultra', detectedBy: 'gpu' }),
    runInstall: async (plan) => ({ success: true, mods: plan.mods.map((m) => ({ ...m, status: 'installed', installedFiles: [{ dest: '/x', backupPath: null }] })) }),
    cancelInstall: async () => true,
    runUninstall: async () => [],
    getGraphicsInfo: async () => ({ tiers: {}, common: { available: false } }),
    listAddons: async () => ([
      { id: 'hud-gas', name: { fa: 'نمایشگر گاز', en: 'Gas HUD' }, description: { fa: 'توضیح', en: 'desc' }, version: '1.0', author: 'UHM', category: 'hud', requires: [], recommendedTiers: ['ultra'], order: 1, fileCount: 2, sizeBytes: 100, available: true, hasMeta: true, previewDataUrl: null, topLevel: ['apps/'] },
      { id: 'empty-addon', name: { fa: 'Empty', en: 'Empty' }, description: { fa: '', en: '' }, version: null, author: null, category: null, requires: [], recommendedTiers: [], order: 1000, fileCount: 0, sizeBytes: 0, available: false, hasMeta: false, previewDataUrl: null, topLevel: [] }
    ]),
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
    getPreviewCandidates: async () => [],
    copyText: async () => true,
    getPathForFile: () => '/fake/dropped.zip',
    pickModFiles: async () => ['/fake/dropped.zip'],
    analyzeModSource: async (payload) => {
      // Simulate a password-protected RAR for the demo flow.
      if (payload && payload.sourcePath && /\.rar$/i.test(payload.sourcePath)) {
        if (!payload.password) return { ok: false, error: 'PASSWORD_REQUIRED', encrypted: 'header', source: { label: 'demo.rar' } };
        if (payload.password !== 'secret') return { ok: false, error: 'PASSWORD_INCORRECT', source: { label: 'demo.rar' } };
      }
      return {
        ok: true,
        source: { label: 'demo.zip', kind: 'archive', archiveType: 'zip', sizeBytes: 1024, entryCount: 3 },
        totalItems: 1,
        items: [{
          id: 'car:demo_car', type: 'car', name: 'demo_car', displayName: 'Demo Car', brand: 'Demo',
          sourceRoot: 'content/cars/demo_car', targetRelative: 'content/cars/demo_car',
          fileCount: 2, sizeBytes: 500, status: 'new', overwriteCount: 0, addCount: 2,
          previewDataUrl: null, files: [{ rel: 'data.acd', size: 100 }, { rel: 'ui/ui_car.json', size: 50 }]
        }],
        warnings: []
      };
    },
    installMod: async (payload) => ({ success: true, cancelled: false, installedCount: 1, items: [{ id: 'car:demo_car', type: 'car', name: 'demo_car', status: 'installed' }] }),
    cancelModInstall: async () => true,
    onModInstallProgress: () => () => {}
  };

  // بارگذاری اسکریپت‌ها (به همان ترتیب index.html)
  const files = [
    'src/js/i18n.js',
    'src/js/ui.js',
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
    'src/pages/addons.js',
    'src/js/libraryData.js',
    'src/pages/library.js',
    'src/pages/modInstall.js',
    'src/pages/donate.js'
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
  assert.ok(container.innerHTML.includes('system-info'), 'settings should render system section');
  assert.ok(container.innerHTML.includes('appearanceTitle') || container.innerHTML.includes('ظاهر و زبان'), 'settings should render appearance section');
  assert.ok(container.innerHTML.includes('dataTitle') || container.innerHTML.includes('مدیریت داده'), 'settings should render data section');

  window.navigate('about');
  assert.ok(container.innerHTML.includes('درباره'), 'about should render');
  assert.ok(container.innerHTML.includes('featuresTitle') || container.innerHTML.includes('چرا UHM؟'), 'about should render features');
  assert.ok(container.innerHTML.includes('FAQ') || container.innerHTML.includes('سوالات پرتکرار'), 'about should render FAQ');

  window.navigate('gamePath');
  assert.ok(container.innerHTML.includes('auto-detect') || container.innerHTML.includes('جستجوی خودکار'), 'gamePath should render');
  assert.ok(container.innerHTML.includes('path-input'), 'gamePath should render paste input');
  assert.ok(container.innerHTML.includes('validation-grid'), 'gamePath should render validation details');

  window.navigate('baseModsCheck');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(container.innerHTML.includes('CSP'), 'baseModsCheck should render');
  assert.ok(container.innerHTML.includes('foundMarkers') || container.innerHTML.includes('فایل‌های پیدا شده'), 'baseModsCheck should show found markers');

  window.navigate('tierSelect');
  assert.ok(container.innerHTML.includes('شروع نصب') || container.innerHTML.includes('low'), 'tierSelect should render');
  assert.ok(container.innerHTML.includes('tier-mods') || container.innerHTML.includes('tier-mods'), 'tierSelect should list tier mods');

  // == Content Library page ==
  window.navigate('library');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(container.innerHTML.includes('کتابخانه'), 'library should render title');
  assert.ok(container.innerHTML.includes('library-stats'), 'library should render stats');
  assert.ok(container.innerHTML.includes('library-tabs'), 'library should render tabs');
  assert.ok(container.innerHTML.includes('library-search'), 'library should render search');
  assert.ok(container.innerHTML.includes('btn-install-mod'), 'library should have install-mod button');
  assert.ok(container.innerHTML.includes('Ferrari FXX K'), 'library should render scanned car');

  // == Mod install (drag-and-drop) wizard ==
  window.navigate('modInstall', { sources: ['/fake/dropped.zip'] });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(container.innerHTML.includes('mi-list'), 'modInstall should render review list');
  assert.ok(container.innerHTML.includes('Demo Car'), 'modInstall should render detected item');
  assert.ok(container.innerHTML.includes('btn-install'), 'modInstall should render install button');

  // == Mod install: password-protected RAR ==
  window.navigate('modInstall', { sources: ['/fake/demo.rar'] });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(container.innerHTML.includes('mi-password-input'), 'modInstall should prompt for password');
  assert.ok(container.innerHTML.includes('mi-password-title'), 'password prompt should show title');

  // wrong password → stays on prompt, error visible
  let pwInput = document.getElementById('mi-password-input');
  pwInput.value = 'wrong';
  document.getElementById('btn-pw-unlock').dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(container.innerHTML.includes('mi-password-input'), 'should re-prompt after wrong password');
  const pwErr = document.getElementById('mi-password-error');
  assert.ok(pwErr && pwErr.style.display !== 'none', 'password error should be visible after wrong password');

  // correct password → proceeds to review
  pwInput = document.getElementById('mi-password-input');
  pwInput.value = 'secret';
  document.getElementById('btn-pw-unlock').dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(container.innerHTML.includes('mi-list'), 'review should render after correct password');
  assert.ok(container.innerHTML.includes('Demo Car'), 'review should show detected item after unlock');

  const plan = {
    tier: 'ultra', gamePath: '/fake/game',
    mods: [{ id: 'csp', dest: '', type: 'copy', overwrite: true }]
  };
  window.navigate('install', { plan });
  assert.ok(container.innerHTML.includes('CSP'), 'install should render');
  assert.ok(container.innerHTML.includes('install-log'), 'install should render log');
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(container.innerHTML.includes('نصب'), 'install should complete to done');
  assert.ok(container.innerHTML.includes('report-title') || container.innerHTML.includes('گزارش مودها'), 'done should render per-mod report');

  window.navigate('manageMods');
  assert.ok(container.innerHTML.includes('CSP'), 'manageMods should render installed mods');
  assert.ok(container.innerHTML.includes('manage-remove') || container.innerHTML.includes('حذف'), 'manageMods should render remove action');

  // == Donate page ==
  window.navigate('donate');
  assert.ok(container.innerHTML.includes('5859'), 'donate should render the card number');
  assert.ok(container.innerHTML.includes('8318'), 'donate should render the card number grouped');
  assert.ok(container.innerHTML.includes('btn-copy-card'), 'donate should render the copy button');
  assert.ok(container.innerHTML.includes('donate-hero'), 'donate should render the animated hero');
  assert.ok(container.innerHTML.includes('donate-steps'), 'donate should render the how-to steps');

  // copy button → success state (copyText mock resolves true)
  document.getElementById('btn-copy-card').dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 30));
  const copyBtn = document.getElementById('btn-copy-card');
  assert.ok(copyBtn.classList.contains('copied'), 'copy button should enter the copied state');
  assert.ok(container.innerHTML.includes('کپی شد'), 'copy button should show the copied label');

  // == Language switching (中文 / 日本語) ==
  window.navigate('settings');
  const zhBtn = document.querySelector('#lang-toggle button[data-lang="zh"]');
  const jaBtn = document.querySelector('#lang-toggle button[data-lang="ja"]');
  assert.ok(zhBtn, 'settings should offer Chinese');
  assert.ok(jaBtn, 'settings should offer Japanese');

  zhBtn.dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(window.appState.lang, 'zh');
  assert.ok(container.innerHTML.includes('设置'), 'settings should render in Chinese');

  jaBtn.dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(window.appState.lang, 'ja');
  assert.ok(container.innerHTML.includes('設定'), 'settings should render in Japanese');

  // == صفحه‌ی افزونه‌ها: لیست، نصب، حذف ==
  window.appState.lang = 'fa';
  window.appState.settings.gamePath = 'C:/game';
  window.navigate('addons');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(container.innerHTML.includes('نمایشگر گاز'), 'addons should list add-on with localized name');
  assert.ok(container.innerHTML.includes('فایل افزونه موجود نیست'), 'addons should flag empty add-on');
  const installBtn = container.querySelector('[data-action="install"][data-id="hud-gas"]');
  assert.ok(installBtn && !installBtn.disabled, 'available add-on should be installable');
  assert.ok(container.querySelector('[data-action="install"][data-id="empty-addon"]').disabled, 'empty add-on must be disabled');
  installBtn.click();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(window.appState.manifest.mods['hud-gas'], 'install should record add-on in manifest');
  assert.strictEqual(window.appState.manifest.mods['hud-gas'][0].kind, 'addon');
  assert.ok(container.querySelector('[data-action="remove"][data-id="hud-gas"]'), 'installed add-on should offer remove');
  window.uhmConfirm = async () => true;
  container.querySelector('[data-action="remove"][data-id="hud-gas"]').click();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!window.appState.manifest.mods['hud-gas'], 'remove should drop add-on from manifest');
  assert.ok(container.querySelector('[data-action="install"][data-id="hud-gas"]'), 'removed add-on should be installable again');

  // == پلن نصب پک گرافیکی: یک واحد + exclude برای CSP نگه‌داشته‌شده ==
  window.appState.overwriteDecisions = { csp: false, pure: true };
  window.navigate('tierSelect');
  await new Promise((r) => setTimeout(r, 30));
  const ultraCard = container.querySelector('.tier-card[data-tier="ultra"]');
  assert.ok(ultraCard, 'tier cards should render');
  ultraCard.click();
  const continueBtn = container.querySelector('#btn-continue') || container.querySelector('#btn-next') || container.querySelector('.wizard-footer .btn-primary');
  assert.ok(continueBtn, 'tier select should have a continue button');
  continueBtn.click();
  await new Promise((r) => setTimeout(r, 30));
  const gplan = window.appState.installPlan;
  assert.ok(gplan && gplan.mods.length === 1 && gplan.mods[0].id === 'graphics', 'plan must contain exactly the graphics pack');
  assert.strictEqual(gplan.tier, 'ultra');
  assert.ok(gplan.mods[0].exclude.includes('dwrite.dll'), 'keeping CSP must exclude its paths');
  assert.ok(!gplan.mods[0].exclude.some((p) => /pure/i.test(p)), 'PURE overwrite=true must not be excluded');

  // == تست mock پیش‌نمایش مرورگر (npm run serve) ==
  const { window: pw, document: pd } = parseHTML('<!DOCTYPE html><body></body>');
  pw.localStorage = { getItem: () => null, setItem: () => {} };
  loadScript({ window: pw, document: pd }, 'src/js/browser-preview.js');
  assert.ok(pw.uhm, 'browser preview should define window.uhm when absent');
  const pv = await pw.uhm.runInstall({ tier: 'high', mods: [{ id: 'graphics' }] });
  assert.ok((await pw.uhm.listAddons()).length >= 2, 'browser preview should list demo add-ons');
  assert.strictEqual(pv.success, true);
  assert.strictEqual(pv.mods.length, 1);

  console.log('RENDERER TESTS PASSED');
}

bootstrap().catch((e) => { console.error('RENDERER TEST FAILED', e); process.exit(1); });
