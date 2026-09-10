/* پیش‌نمایش مرورگر: اگر در Electron اجرا نشده باشیم، window.uhm را شبیه‌سازی می‌کنیم.
   این فایل در Electron بارگذاری نمی‌شود زیرا window.uhm از قبل توسط preload تعریف شده است. */
(function () {
  if (window.uhm) return;

  const LS_KEY = 'uhm-preview-state';
  const DEMO_GAME_PATH = '/demo/AssettoCorsa';
  let state = {
    settings: { language: 'fa', theme: 'night', gamePath: DEMO_GAME_PATH },
    manifest: { appVersion: '1.0.0', systemTier: null, lastInstallDate: null, mods: {} }
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) state = JSON.parse(raw);
    // For the in-chat demo, never trap the user behind the path step.
    if (!state.settings) state.settings = {};
    if (!state.settings.gamePath) state.settings.gamePath = DEMO_GAME_PATH;
  } catch (e) { /* ignore */ }

  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} };

  const PALETTES = [
    ['#0b1e3a', '#1e90ff'],
    ['#2a0f24', '#ff5b6e'],
    ['#14230f', '#3ddc84'],
    ['#231505', '#ffc24b'],
    ['#120a2e', '#a98bff'],
    ['#081d1d', '#4facfe']
  ];

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function createDemoPreview(relPath) {
    const seed = String(relPath || 'demo');
    const [c1, c2] = PALETTES[hashStr(seed) % PALETTES.length];
    const isTrack = seed.indexOf('/tracks/') > -1;
    const glyph = isTrack ? '📍' : '🏁';
    const label = seed.split('/').filter(Boolean).slice(-2)[0] || 'Content';
    const name = String(label).replace(/_/g, ' ').toUpperCase();
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
      `</linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#g)"/>` +
      `<circle cx="120" cy="70" r="120" fill="rgba(255,255,255,0.08)"/>` +
      `<circle cx="560" cy="300" r="150" fill="rgba(0,0,0,0.10)"/>` +
      `<text x="50%" y="42%" text-anchor="middle" font-size="76" font-family="Segoe UI, sans-serif">${glyph}</text>` +
      `<text x="50%" y="68%" text-anchor="middle" font-size="26" font-family="Segoe UI, sans-serif" font-weight="700" fill="#ffffff" letter-spacing="2">${name}</text>` +
      `<text x="50%" y="82%" text-anchor="middle" font-size="13" font-family="Segoe UI, sans-serif" fill="rgba(255,255,255,0.65)">${isTrack ? 'TRACK' : 'CAR'} · UHM CONTENT LIBRARY</text>` +
      `</svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }


  window.uhm = {
    windowMinimize() {},
    windowToggleMaximize() {},
    windowClose() {},
    async getSettings() { return state.settings; },
    async setSettings(p) { Object.assign(state.settings, p); persist(); return state.settings; },
    async getManifest() { return state.manifest; },
    async saveManifest(m) { state.manifest = m; persist(); return true; },
    async browseGamePath() { return '/program/Steam/steamapps/common/assettocorsa'; },
    async validateGamePath(p) { return { valid: true }; },
    async autoDetectGamePath() { return '/program/Steam/steamapps/common/assettocorsa'; },
    async checkBaseMods() { return { csp: { found: true, markers: [] }, pure: { found: false, markers: [] } }; },
    async copyWithBackup() { return { success: true }; },
    async restoreOrDelete() { return { status: 'deleted' }; },
    async scanLibrary() {
      const mk = (type, folder, name, extra) => ({
        type, id: type + ':' + folder, folder, name,
        brand: '', 'class': '', klass: '', country: '', city: '', location: '',
        length: '', year: '', description: '',
        specs: {}, hasPreview: true, preview: 'content/' + (type === 'car' ? 'cars' : 'tracks') + '/' + folder + '/ui/preview.png', previewVariants: ['ui/preview.png'],
        isKunos: false, isDlc: false, isMod: true, origin: 'mod',
        skinCount: 0, skins: [], layouts: [], hasData: true, hasSound: true, hasCamera: false,
        sizeBytes: 0, fileCount: 0, modifiedAt: new Date().toISOString(), hasUi: true,
        ...extra
      });
      return {
        cars: [
          mk('car', 'ks_ferrari_fxxk', 'Ferrari FXX-K', { isKunos: true, isMod: false, origin: 'kunos', brand: 'Ferrari', 'class': 'Race', year: '2014', specs: { power: '860', weight: '1150' }, skinCount: 4, skins: ['Red', 'Black'], sizeBytes: 48 * 1024 * 1024, fileCount: 172, description: 'A race-bred hypercar homologated for the track. Pure FXX-K.' }),
          mk('car', 'bmw_m3_e30', 'BMW M3 E30', { brand: 'BMW', 'class': 'Road', year: '1986', specs: { power: '230', weight: '1200' }, skinCount: 2, isMod: true, sizeBytes: 21 * 1024 * 1024, fileCount: 88, description: 'The legendary boxy M3 with a high-revving inline four.' }),
          mk('car', 'porsche_911_gt3_rs', 'Porsche 911 GT3 RS', { isDlc: true, isMod: false, origin: 'dlc', brand: 'Porsche', 'class': 'GT', year: '2019', specs: { power: '520', weight: '1420', topSpeed: '312' }, skinCount: 6, skins: ['GT Silver', 'Lava Orange', 'White', 'Black'], sizeBytes: 63 * 1024 * 1024, fileCount: 240, description: 'Track-focused 911 with extreme aero and a screaming flat-six.' }),
          mk('car', 'mazda_mx5_cup', 'Mazda MX-5 Cup', { isMod: true, origin: 'mod', brand: 'Mazda', 'class': 'Cup', year: '2016', specs: { power: '205', weight: '1050' }, skinCount: 8, skins: ['White', 'Red', 'Blue', 'Yellow'], sizeBytes: 12 * 1024 * 1024, fileCount: 61, description: 'Pure ladder-of-learning roadster with a friendly handling.' })
        ],
        tracks: [
          mk('track', 'ks_monza', 'Monza', { isKunos: true, isMod: false, origin: 'kunos', country: 'Italy', city: 'Monza', length: '5.79 km', width: '12 m', layoutCount: 2, layouts: [{ name: 'Grand Prix', length: '5.79 km', country: 'Italy' }, { name: 'Junior', length: '3.3 km', country: 'Italy' }], sizeBytes: 96 * 1024 * 1024, fileCount: 310, description: 'The Temple of Speed. Long straights and famous chicanes.' }),
          mk('track', 'drift_city', 'Drift City', { isMod: true, origin: 'mod', country: 'Japan', city: 'Osaka', length: '2.1 km', layoutCount: 1, layouts: [{ name: 'Main', length: '2.1 km', country: 'Japan' }], sizeBytes: 30 * 1024 * 1024, fileCount: 95, description: 'A flowy street circuit built for long, smooth drifts.' }),
          mk('track', 'ks_nordschleife', 'Nürburgring Nordschleife', { isKunos: true, isMod: false, origin: 'kunos', country: 'Germany', city: 'Nürburg', length: '20.8 km', width: '10 m', layoutCount: 3, layouts: [{ name: 'Nordschleife', length: '20.8 km', country: 'Germany' }, { name: 'GP', length: '5.1 km', country: 'Germany' }, { name: 'Combined', length: '25.9 km', country: 'Germany' }], sizeBytes: 130 * 1024 * 1024, fileCount: 480, description: 'The Green Hell — the most demanding road circuit on Earth.' })
        ]
      };
    },
    async getContentPreview(payload) {
      return createDemoPreview(payload && payload.relPath);
    },
    async deleteContent() { return { success: true }; },
    async restoreContent() { return { success: true }; },
    async revealContent() { return { success: true }; },
    async purgeContent() { return { success: true }; },
    async emptyTrash() { return { success: true }; },
    async listTrash() { return []; },
    async getPreviewCandidates() { return []; },
    async pathExists() { return true; },
    async getLocalAppData() { return 'C:\\AppData'; },
    async detectSystemSpecs() {
      return {
        platform: 'win32',
        osVersion: '10.0.22631',
        cpuName: 'Intel(R) Core(TM) i7-12700K',
        cpuCores: 12,
        totalMemGb: 32,
        gpuName: 'NVIDIA GeForce RTX 3060',
        gpuVramGb: 12,
        driverVersion: '31.0.15.3623',
        gpuSource: 'nvidia-smi',
        suggestedTier: 'ultra',
        detectedBy: 'gpu',
        tierReason: 'ultra'
      };
    },
    async suggestTier() { return { tier: 'ultra', detectedBy: 'gpu', score: 5 }; },
    async runInstall(plan) {
      window.__previewIdx = 0;
      const mods = [];
      for (const m of plan.mods) {
        mods.push({ id: m.id, status: 'installed', tier: plan.tier, installedFiles: [{ dest: `/game/${m.id}/file`, backupPath: null }] });
        await new Promise((r) => setTimeout(r, 120));
      }
      return { success: true, cancelled: false, mods };
    },
    async cancelInstall() { return true; },
    async runUninstall() { return []; },
    async listModAssets() { return ['csp', 'pure', 'ppfilter', 'chasecam', 'hud', 'srp', 'video']; },
    onInstallProgress(cb) {
      let cancelled = false;
      const id = setInterval(() => {
        if (cancelled) return;
        const plan = window.appState && window.appState.installPlan;
        if (!plan || !plan.mods || !plan.mods.length) return;
        const thisMod = plan.mods[window.__previewIdx || 0];
        if (!thisMod) return;
        cb({ done: (window.__previewIdx || 0) + 1, total: plan.mods.length, mod: { id: thisMod.id, status: (window.__previewIdx || 0) + 1 >= plan.mods.length ? 'installed' : 'running' }, stage: (window.__previewIdx || 0) + 1 >= plan.mods.length ? 'installed' : 'start' });
        window.__previewIdx = (window.__previewIdx || 0) + 1;
      }, 250);
      return () => { cancelled = true; clearInterval(id); };
    },
    openExternal(url) { window.open(url, '_blank'); },
    onScanProgress() { return () => {}; }
  };
})();
