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

  // عملیات فایل
  copyWithBackup: (args) => ipcRenderer.invoke('fs:copy-with-backup', args),
  restoreOrDelete: (args) => ipcRenderer.invoke('fs:restore-or-delete', args),
  pathExists: (p) => ipcRenderer.invoke('fs:path-exists', p),
  getLocalAppData: () => ipcRenderer.invoke('system:get-local-appdata'),

  // لینک خارجی
  openExternal: (url) => ipcRenderer.send('shell:open-external', url)
});
