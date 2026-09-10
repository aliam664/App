/* پیش‌نمایش مرورگر: اگر در Electron اجرا نشده باشیم، window.uhm را شبیه‌سازی می‌کنیم.
   این فایل در Electron بارگذاری نمی‌شود زیرا window.uhm از قبل توسط preload تعریف شده است. */
(function () {
  if (window.uhm) return;

  const LS_KEY = 'uhm-preview-state';
  let state = { settings: { language: 'fa', theme: 'night', gamePath: null }, manifest: { appVersion: '1.0.0', systemTier: null, lastInstallDate: null, mods: {} } };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} };

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
        specs: {}, hasPreview: false, preview: null, previewVariants: [],
        isKunos: false, isDlc: false, isMod: true, origin: 'mod',
        skinCount: 0, skins: [], layouts: [], hasData: true, hasSound: true, hasCamera: false,
        sizeBytes: 0, fileCount: 0, modifiedAt: new Date().toISOString(), hasUi: true,
        ...extra
      });
      return {
        cars: [
          mk('car', 'ks_ferrari_fxxk', 'Ferrari FXX-K', { isKunos: true, isMod: false, origin: 'kunos', brand: 'Ferrari', 'class': 'Race', year: '2014', specs: { power: '860', weight: '1150' }, skinCount: 4, skins: ['Red', 'Black'] }),
          mk('car', 'bmw_m3_e30', 'BMW M3 E30', { brand: 'BMW', 'class': 'Road', year: '1986', specs: { power: '230', weight: '1200' }, skinCount: 2, isMod: true })
        ],
        tracks: [
          mk('track', 'ks_monza', 'Monza', { isKunos: true, isMod: false, origin: 'kunos', country: 'Italy', length: '5.79 km', layoutCount: 2, layouts: [{ name: 'GP', length: '5.79 km', country: 'Italy' }, { name: 'Junior', length: '3.3 km', country: 'Italy' }] }),
          mk('track', 'drift_city', 'Drift City', { country: 'Japan', length: '2.1 km', layoutCount: 1 })
        ]
      };
    },
    async getContentPreview() { return null; },
    async deleteContent() { return { success: true }; },
    async restoreContent() { return { success: true }; },
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
    openExternal(url) { window.open(url, '_blank'); }
  };
})();
