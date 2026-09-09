const { contextBridge, ipcRenderer } = require('electron');

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
  detectSystemSpecs: () => ipcRenderer.invoke('system:detect-specs'),
  suggestTier: (specs) => ipcRenderer.invoke('system:suggest-tier', specs),

  // نصب / حذف
  runInstall: (payload) => ipcRenderer.invoke('install:run', payload),
  cancelInstall: () => ipcRenderer.invoke('install:cancel'),
  runUninstall: (payload) => ipcRenderer.invoke('uninstall:run', payload),

  // رویدادهای پیشرفت نصب
  onInstallProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('install:progress', listener);
    return () => ipcRenderer.removeListener('install:progress', listener);
  },

  // لینک خارجی
  openExternal: (url) => ipcRenderer.send('shell:open-external', url)
});
