const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { installMods, uninstallFiles } = require('./src/lib/installer');
const { detectSystemSpecs, suggestTierFromSpecs } = require('./src/lib/hardware');

/* ------------------------------------------------------------------ */
/*  Electron / window bootstrap                                        */
/* ------------------------------------------------------------------ */

app.commandLine.appendSwitch('enable-transparent-visuals');
app.disableHardwareAcceleration();

let mainWindow = null;

const USER_DATA_DIR = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json');
const MANIFEST_PATH = path.join(USER_DATA_DIR, 'manifest.json');
const BACKUPS_DIR = path.join(USER_DATA_DIR, 'backups');
const TRASH_PATH = path.join(USER_DATA_DIR, 'trash.json');

// در نسخه‌ی بسته‌بندی‌شده، فایل‌های مود به‌صورت asarUnpack در آدرس .unpacked قرار می‌گیرند.
const RESOURCE_ROOT = app.isPackaged ? `${app.getAppPath()}.unpacked` : app.getAppPath();
const ASSETS_MOD_DIR = path.join(RESOURCE_ROOT, 'src', 'assets', 'mod-files');

let installCancelled = false;

function ensureUserDataFiles() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({
      language: 'fa',
      theme: 'night',
      gamePath: null
    }, null, 2));
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
      appVersion: app.getVersion(),
      gamePath: null,
      systemTier: null,
      lastInstallDate: null,
      mods: {}
    }, null, 2));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'src', 'assets', 'images', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  ensureUserDataFiles();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function safeReadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

function safeWriteJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Content library helpers (cars / tracks / mods)                     */
/* ------------------------------------------------------------------ */

function readJsonSilent(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function stringifyUiValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.en || value.EN || value.English || value['en-US'] || Object.values(value)[0] || '';
  }
  return '';
}

function findPreviewFile(baseDir) {
  const candidates = [
    path.join(baseDir, 'ui', 'preview.png'),
    path.join(baseDir, 'ui', 'preview.jpg'),
    path.join(baseDir, 'preview.png'),
    path.join(baseDir, 'preview.jpg'),
    path.join(baseDir, 'ui', 'ui_preview.jpg')
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function safeLeaf(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function listContentFolders(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function loadTrash() {
  const data = readJsonSilent(TRASH_PATH);
  return Array.isArray(data) ? data : [];
}

function saveTrash(list) {
  safeWriteJson(TRASH_PATH, list);
}

function scanCars(gamePath) {
  const carsRoot = path.join(gamePath, 'content', 'cars');
  const result = [];
  for (const folder of listContentFolders(carsRoot)) {
    const carDir = path.join(carsRoot, folder);
    const ui = readJsonSilent(path.join(carDir, 'ui', 'ui_car.json')) ||
               readJsonSilent(path.join(carDir, 'ui', 'car.json')) || {};
    const name = stringifyUiValue(ui.name) || folder;
    const brand = stringifyUiValue(ui.brand) || '';
    const klass = stringifyUiValue(ui['class']) || '';
    const preview = findPreviewFile(carDir);
    result.push({
      type: 'car',
      id: folder,
      folder,
      name,
      brand,
      klass: klass,
      preview: preview ? path.relative(gamePath, preview) : null,
      hasPreview: Boolean(preview),
      isKunos: /^ks_/i.test(folder),
      mod: !/^ks_/i.test(folder)
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

function scanTracks(gamePath) {
  const tracksRoot = path.join(gamePath, 'content', 'tracks');
  const result = [];
  for (const folder of listContentFolders(tracksRoot)) {
    const trackDir = path.join(tracksRoot, folder);
    const ui = readJsonSilent(path.join(trackDir, 'ui', 'ui_track.json')) ||
               readJsonSilent(path.join(trackDir, 'ui', 'track.json')) || {};
    const name = stringifyUiValue(ui.name) || folder;
    const location = stringifyUiValue(ui.location) || '';
    const country = stringifyUiValue(ui.country) || '';
    const length = ui.length ? String(ui.length) : '';
    const city = stringifyUiValue(ui.city) || '';
    const preview = findPreviewFile(trackDir);
    result.push({
      type: 'track',
      id: folder,
      folder,
      name,
      location,
      country,
      city,
      length,
      preview: preview ? path.relative(gamePath, preview) : null,
      hasPreview: Boolean(preview),
      isKunos: /^ks_/i.test(folder),
      mod: !/^ks_/i.test(folder)
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

function scanContentLibrary(gamePath) {
  if (!gamePath || !fs.existsSync(gamePath)) return { cars: [], tracks: [] };
  return {
    cars: scanCars(gamePath),
    tracks: scanTracks(gamePath)
  };
}

function previewToDataUrl(fullPath) {
  try {
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const buf = fs.readFileSync(fullPath);
    if (buf.length > 900 * 1024) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

function moveToTrash(gamePath, contentType, folder) {
  const contentRoot = contentType === 'car'
    ? path.join(gamePath, 'content', 'cars')
    : contentType === 'track'
      ? path.join(gamePath, 'content', 'tracks')
      : null;
  const source = contentRoot ? path.join(contentRoot, folder) : null;
  if (!source || !fs.existsSync(source)) return { success: false, error: 'NOT_FOUND' };

  const stamp = Date.now();
  const entryDir = path.join(USER_DATA_DIR, 'trash', `${stamp}_${safeLeaf(folder)}`);
  try {
    fs.mkdirSync(path.dirname(entryDir), { recursive: true });
    fs.cpSync(source, entryDir, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });

    const trash = loadTrash();
    trash.unshift({
      id: `${stamp}_${folder}`,
      type: contentType,
      folder,
      originalPath: source,
      trashPath: entryDir,
      deletedAt: new Date().toISOString(),
      isKunos: /^ks_/i.test(folder)
    });
    saveTrash(trash);
    return { success: true, trashId: trash[0].id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function restoreFromTrash(trashId) {
  const trash = loadTrash();
  const entry = trash.find((t) => t.id === trashId);
  if (!entry) return { success: false, error: 'NOT_FOUND' };
  try {
    fs.mkdirSync(path.dirname(entry.originalPath), { recursive: true });
    if (fs.existsSync(entry.trashPath)) {
      fs.cpSync(entry.trashPath, entry.originalPath, { recursive: true });
    }
    fs.rmSync(entry.trashPath, { recursive: true, force: true });
    saveTrash(trash.filter((t) => t.id !== trashId));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function listTrash() {
  return loadTrash().map((t) => ({
    id: t.id,
    type: t.type,
    folder: t.folder,
    originalPath: t.originalPath,
    trashPath: t.trashPath,
    deletedAt: t.deletedAt,
    isKunos: Boolean(t.isKunos)
  }));
}

/* ------------------------------------------------------------------ */
/*  Window controls                                                    */
/* ------------------------------------------------------------------ */

ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

/* ------------------------------------------------------------------ */
/*  Settings / manifest                                                */
/* ------------------------------------------------------------------ */

ipcMain.handle('settings:get', () => safeReadJson(SETTINGS_PATH, {}));

ipcMain.handle('settings:set', (event, partialSettings) => {
  const current = safeReadJson(SETTINGS_PATH, {});
  const updated = { ...current, ...(partialSettings || {}) };
  safeWriteJson(SETTINGS_PATH, updated);
  return updated;
});

ipcMain.handle('manifest:get', () => safeReadJson(MANIFEST_PATH, {}));

ipcMain.handle('manifest:save', (event, manifestData) => {
  safeWriteJson(MANIFEST_PATH, manifestData);
  return true;
});

/* ------------------------------------------------------------------ */
/*  Game path handling                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('game:browse-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'پوشه‌ی نصب Assetto Corsa را انتخاب کنید'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('game:validate-path', (event, gamePath) => {
  if (!gamePath) return { valid: false, reason: 'EMPTY' };
  const contentDir = path.join(gamePath, 'content');
  const hasExe = fs.existsSync(path.join(gamePath, 'acs.exe')) ||
                 fs.existsSync(path.join(gamePath, 'assettocorsa.exe'));
  if (!hasExe) return { valid: false, reason: 'NO_ACS_EXE' };
  if (!fs.existsSync(contentDir)) return { valid: false, reason: 'NO_CONTENT_DIR' };
  return { valid: true };
});

function parseSteamLibraryFolders(vdfPath) {
  const results = [];
  if (!fs.existsSync(vdfPath)) return results;
  try {
    const text = fs.readFileSync(vdfPath, 'utf-8');
    const matches = text.match(/"path"\s+"([^"]+)"/g) || [];
    for (const m of matches) {
      const p = m.replace(/"path"\s+"([^"]+)"/, '$1').replace(/\\\\/g, '\\');
      results.push(path.join(p, 'steamapps', 'common', 'assettocorsa'));
    }
  } catch (e) { /* ignore */ }
  return results;
}

ipcMain.handle('game:auto-detect', async () => {
  const candidates = new Set();

  const programFiles = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programFilesX64 = process.env.ProgramFiles || 'C:\\Program Files';
  const steamDefault = [
    path.join(programFiles, 'Steam', 'steamapps', 'common', 'assettocorsa'),
    path.join(programFilesX64, 'Steam', 'steamapps', 'common', 'assettocorsa'),
    'C:\\Steam\\steamapps\\common\\assettocorsa'
  ];
  for (const p of steamDefault) candidates.add(p);

  for (const drive of 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    candidates.add(`${drive}:\\SteamLibrary\\steamapps\\common\\assettocorsa`);
    candidates.add(`${drive}:\\Steam\\steamapps\\common\\assettocorsa`);
    candidates.add(`${drive}:\\Games\\Steam\\steamapps\\common\\assettocorsa`);
  }

  for (const base of steamDefault) {
    const steamApps = path.dirname(path.dirname(base));
    const vdf = path.join(steamApps, 'libraryfolders.vdf');
    for (const p of parseSteamLibraryFolders(vdf)) candidates.add(p);
  }
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
    for (const steel of ['Steam', 'SteamLibrary', 'Games\\Steam']) {
      const vdf = `${drive}:\\${steel}\\steamapps\\libraryfolders.vdf`;
      for (const p of parseSteamLibraryFolders(vdf)) candidates.add(p);
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) &&
        (fs.existsSync(path.join(candidate, 'acs.exe')) ||
         fs.existsSync(path.join(candidate, 'assettocorsa.exe')))) {
      return candidate;
    }
  }
  return null;
});

/* ------------------------------------------------------------------ */
/*  Base mods detection (CSP / PURE)                                   */
/* ------------------------------------------------------------------ */

ipcMain.handle('game:check-base-mods', (event, gamePath) => {
  const result = {
    csp: { found: false, markers: [] },
    pure: { found: false, markers: [] }
  };
  if (!gamePath) return result;

  const cspMarkers = [
    path.join(gamePath, 'extension', 'config', 'data_manifest.ini'),
    path.join(gamePath, 'extension', 'config', 'data_manifest'),
    path.join(gamePath, 'extension', 'dwrite.ini')
  ];
  const pureMarkers = [
    path.join(gamePath, 'extension', 'config-ext', 'Pure'),
    path.join(gamePath, 'extension', 'config-ext', 'pure'),
    path.join(gamePath, 'extension', 'pure'),
    path.join(gamePath, 'extension', 'config', 'pure.ini')
  ];

  for (const p of cspMarkers) {
    if (fs.existsSync(p)) {
      result.csp.found = true;
      result.csp.markers.push(p);
    }
  }
  for (const p of pureMarkers) {
    if (fs.existsSync(p)) {
      result.pure.found = true;
      result.pure.markers.push(p);
    }
  }
  return result;
});

/* ------------------------------------------------------------------ */
/*  Install / uninstall via installer core                             */
/* ------------------------------------------------------------------ */

ipcMain.handle('install:run', async (event, payload) => {
  installCancelled = false;
  const { gamePath = '', tier = null, mods = [] } = payload || {};

  const result = await installMods({
    gamePath,
    tier,
    mods,
    assetsModDir: ASSETS_MOD_DIR,
    backupsDir: BACKUPS_DIR,
    onProgress: (data) => broadcast('install:progress', data),
    isCancelled: () => installCancelled
  });

  installCancelled = false;
  return result;
});

ipcMain.handle('install:cancel', () => {
  installCancelled = true;
  return true;
});

ipcMain.handle('uninstall:run', (event, payload) => {
  return uninstallFiles((payload && payload.files) || []);
});

/* ------------------------------------------------------------------ */
/*  Content library IPC (my mods / cars / tracks)                      */
/* ------------------------------------------------------------------ */

ipcMain.handle('library:scan', (event, gamePath) => {
  return scanContentLibrary(gamePath);
});

ipcMain.handle('library:get-preview', (event, { gamePath, relPath }) => {
  if (!gamePath || !relPath || !isSafePathUnder(gamePath, relPath)) return null;
  return previewToDataUrl(path.join(gamePath, relPath));
});

ipcMain.handle('library:delete', (event, { gamePath, type, folder }) => {
  return moveToTrash(gamePath, type === 'track' ? 'track' : 'car', folder);
});

ipcMain.handle('library:restore', (event, { trashId }) => {
  return restoreFromTrash(trashId);
});

ipcMain.handle('library:trash', () => {
  return listTrash();
});

function isSafePathUnder(base, rel) {
  const resolved = path.resolve(base, rel);
  const relToBase = path.relative(path.resolve(base), resolved);
  return relToBase === '' || (!relToBase.startsWith('..') && !path.isAbsolute(relToBase));
}

/* ------------------------------------------------------------------ */
/*  Hardware detection / smart tier                                    */
/* ------------------------------------------------------------------ */

ipcMain.handle('system:detect-specs', async () => {
  return detectSystemSpecs();
});

ipcMain.handle('system:suggest-tier', (event, specs) => {
  return suggestTierFromSpecs(specs || {});
});

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

ipcMain.on('shell:open-external', (event, url) => {
  if (isSafeExternalUrl(url)) shell.openExternal(url);
});
