const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('uhm', {
  // کنترل پنجره
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // تنظیمات
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  // مانیفست
  getManifest: () => ipcRenderer.invoke('manifest:get'),
  saveManifest: (data) => ipcRenderer.invoke('manifest:save', data),

  // مسیر بازی
  browseGamePath: () => ipcRenderer.invoke('game:browse-path'),
  validateGamePath: (p) => ipcRenderer.invoke('game:validate-path', p),
  autoDetectGamePath: () => ipcRenderer.invoke('game:auto-detect'),
  checkBaseMods: (gamePath) => ipcRenderer.invoke('game:check-base-mods', gamePath),

  // تشخیص سخت‌افزار و پیشنهاد سطح
  detectSystemSpecs: (options) => ipcRenderer.invoke('system:detect-specs', options),
  suggestTier: (specs) => ipcRenderer.invoke('system:suggest-tier', specs),

  // کتابخانه‌ی محتوا (مودها / ماشین‌ها / مپ‌ها)
  scanLibrary: (gamePath) => ipcRenderer.invoke('library:scan', gamePath),
  getContentPreview: (payload) => ipcRenderer.invoke('library:get-preview', payload),
  revealContent: (payload) => ipcRenderer.invoke('library:reveal', payload),
  deleteContent: (payload) => ipcRenderer.invoke('library:delete', payload),
  restoreContent: (payload) => ipcRenderer.invoke('library:restore', payload),
  purgeContent: (payload) => ipcRenderer.invoke('library:purge', payload),
  emptyTrash: () => ipcRenderer.invoke('library:empty-trash'),
  listTrash: () => ipcRenderer.invoke('library:trash'),
  getPreviewCandidates: (type) => ipcRenderer.invoke('library:preview-candidates', type),

  // نصب / حذف
  runInstall: (payload) => ipcRenderer.invoke('install:run', payload),
  cancelInstall: () => ipcRenderer.invoke('install:cancel'),
  runUninstall: (payload) => ipcRenderer.invoke('uninstall:run', payload),

  // نصب مود با درگ‌اند‌دراپ (شبیه Content Manager)
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (e) { /* older Electron */ }
    try { return file && file.path ? file.path : null; } catch (e) { return null; }
  },
  analyzeModSource: (payload) => ipcRenderer.invoke('mods:analyze', payload),
  installMod: (payload) => ipcRenderer.invoke('mods:install', payload),
  cancelModInstall: () => ipcRenderer.invoke('mods:cancel'),
  pickModFiles: () => ipcRenderer.invoke('mods:pick-file'),

  // رویدادهای پیشرفت نصب مود
  onModInstallProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mods:install-progress', listener);
    return () => ipcRenderer.removeListener('mods:install-progress', listener);
  },

  // رویدادهای پیشرفت نصب
  onInstallProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('install:progress', listener);
    return () => ipcRenderer.removeListener('install:progress', listener);
  },

  // رویدادهای پیشرفت اسکن کتابخانه
  onScanProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('library:scan-progress', listener);
    return () => ipcRenderer.removeListener('library:scan-progress', listener);
  },

  // لینک خارجی
  openExternal: (url) => ipcRenderer.send('shell:open-external', url)
});
