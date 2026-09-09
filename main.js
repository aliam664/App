const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// رفع یک باگ شناخته‌شده‌ی الکترون روی ویندوز: وقتی پنجره transparent باشه،
// رندر شتاب‌دهی‌شده‌ی سخت‌افزاری باعث می‌شه پس‌زمینه از گوشه‌های گرد (clip-path) بیرون بزنه.
// غیرفعال کردن GPU acceleration این مشکل رو حل می‌کنه.
app.commandLine.appendSwitch('enable-transparent-visuals');
app.disableHardwareAcceleration();

let mainWindow;

// مسیر ذخیره‌ی داده‌های برنامه (تنظیمات + مانیفست نصب)
const USER_DATA_DIR = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json');
const MANIFEST_PATH = path.join(USER_DATA_DIR, 'manifest.json');
const BACKUPS_DIR = path.join(USER_DATA_DIR, 'backups');

function ensureUserDataFiles() {
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // مفید برای دیباگ در حین توسعه - بعدا حذف شود
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
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

/* ---------------- کنترل پنجره (چون فریملسه) ---------------- */
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

/* ---------------- تنظیمات ---------------- */
ipcMain.handle('settings:get', () => {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
});
ipcMain.handle('settings:set', (event, partialSettings) => {
  const current = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  const updated = { ...current, ...partialSettings };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
});

/* ---------------- مانیفست نصب ---------------- */
ipcMain.handle('manifest:get', () => {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
});
ipcMain.handle('manifest:save', (event, manifestData) => {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2));
  return true;
});

/* ---------------- انتخاب مسیر بازی (دستی) ---------------- */
ipcMain.handle('game:browse-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'پوشه‌ی نصب Assetto Corsa را انتخاب کنید'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/* ---------------- اعتبارسنجی مسیر بازی ---------------- */
ipcMain.handle('game:validate-path', (event, gamePath) => {
  if (!gamePath) return { valid: false, reason: 'EMPTY' };
  const acsExe = path.join(gamePath, 'acs.exe');
  const contentDir = path.join(gamePath, 'content');
  if (!fs.existsSync(acsExe)) return { valid: false, reason: 'NO_ACS_EXE' };
  if (!fs.existsSync(contentDir)) return { valid: false, reason: 'NO_CONTENT_DIR' };
  return { valid: true };
});

/* ---------------- جستجوی خودکار مسیر استیم ---------------- */
ipcMain.handle('game:auto-detect', async () => {
  const candidates = [];
  const drives = ['C', 'D', 'E', 'F', 'G', 'H'];

  // مسیرهای معمول نصب استیم روی درایوهای مختلف
  for (const drive of drives) {
    candidates.push(`${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa`);
    candidates.push(`${drive}:\\Steam\\steamapps\\common\\assettocorsa`);
    candidates.push(`${drive}:\\SteamLibrary\\steamapps\\common\\assettocorsa`);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'acs.exe'))) {
      return candidate;
    }
  }
  return null;
});

/* ---------------- چک وجود CSP / PURE از قبل ---------------- */
ipcMain.handle('game:check-base-mods', (event, gamePath) => {
  const result = { csp: { found: false }, pure: { found: false } };
  try {
    const cspMarker = path.join(gamePath, 'extension', 'config', 'data_manifest.ini');
    if (fs.existsSync(cspMarker)) {
      result.csp.found = true;
    }
    const pureMarker = path.join(gamePath, 'extension', 'config-ext', 'Pure');
    if (fs.existsSync(pureMarker)) {
      result.pure.found = true;
    }
  } catch (e) {
    // اگر مسیر نامعتبر بود، همان مقدار پیش‌فرض false برمی‌گردد
  }
  return result;
});

/* ---------------- عملیات فایل: کپی ساده با پشتیبان‌گیری اختیاری ---------------- */
ipcMain.handle('fs:copy-with-backup', (event, { source, destination, takeBackup }) => {
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  let backupPath = null;
  if (takeBackup && fs.existsSync(destination)) {
    const modBackupDir = path.join(BACKUPS_DIR, path.basename(destDir));
    if (!fs.existsSync(modBackupDir)) fs.mkdirSync(modBackupDir, { recursive: true });
    backupPath = path.join(modBackupDir, path.basename(destination) + '.bak');
    fs.copyFileSync(destination, backupPath);
  }

  fs.copyFileSync(source, destination);
  return { success: true, backupPath };
});

/* ---------------- بازگرداندن فایل از بکاپ یا حذف مستقیم ---------------- */
ipcMain.handle('fs:restore-or-delete', (event, { destination, backupPath }) => {
  try {
    if (backupPath) {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, destination);
        fs.unlinkSync(backupPath);
        return { status: 'restored' };
      } else {
        return { status: 'backup_not_found' };
      }
    } else {
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      return { status: 'deleted' };
    }
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

/* ---------------- چک وجود پوشه (برای پیش‌شرط SRP Light) ---------------- */
ipcMain.handle('fs:path-exists', (event, targetPath) => {
  return fs.existsSync(targetPath);
});

/* ---------------- باز کردن لینک خارجی با مرورگر پیش‌فرض ---------------- */
ipcMain.on('shell:open-external', (event, url) => {
  shell.openExternal(url);
});

/* ---------------- مسیر %LOCALAPPDATA% پویا ---------------- */
ipcMain.handle('system:get-local-appdata', () => {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
});
