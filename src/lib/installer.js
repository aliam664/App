/* ------------------------------------------------------------------ */
/*  Installer core — مستقل از Electron، قابل تست                       */
/* ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const rar = require('node-unrar-js');

function isWithin(base, target) {
  const rel = path.relative(base, path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveInside(root, relative) {
  const abs = path.resolve(root, relative || '');
  if (!isWithin(root, abs)) return null;
  return abs;
}

async function copyDirectoryContents(sourceDir, destRoot, modId, records, backupFn, sourceRoot) {
  const root = sourceRoot || sourceDir;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const rel = path.relative(root, src);
    const dest = path.join(destRoot, rel);

    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      await copyDirectoryContents(src, destRoot, modId, records, backupFn, root);
    } else {
      const existed = fs.existsSync(dest);
      let backupPath = null;
      if (existed) {
        backupPath = backupFn(modId, rel);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(dest, backupPath);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      records.push({ file: rel, dest, existed, backupPath });
    }
  }
  return records;
}

async function extractArchive(source, destRoot, modId, records, backupFn) {
  const ext = path.extname(source).toLowerCase();

  if (ext === '.zip') {
    const zip = new AdmZip(source);
    for (const entry of zip.getEntries()) {
      const dest = path.join(destRoot, entry.entryName);
      if (!isWithin(destRoot, dest)) continue;
      const existed = fs.existsSync(dest);
      let backupPath = null;
      if (existed && !entry.isDirectory) {
        backupPath = backupFn(modId, entry.entryName);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(dest, backupPath);
      }
      if (entry.isDirectory) {
        fs.mkdirSync(dest, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
        records.push({ file: entry.entryName, dest, existed, backupPath });
      }
    }
    return records;
  }

  if (ext === '.rar' || ext === '.cbr') {
    const data = fs.readFileSync(source);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const extractor = await rar.createExtractorFromData({ data: buffer });
    // NOTE: node-unrar-js treats an EMPTY `files` array as "extract nothing",
    // so we omit `files` entirely to extract every entry, then fully traverse
    // the lazy iterator (this also avoids a WASM memory leak).
    const list = extractor.extract();
    for (const item of list.files) {
      const file = item.fileHeader.name.replace(/\\/g, '/');
      const isDir = Boolean(item.fileHeader.flags && item.fileHeader.flags.directory);
      const dest = path.join(destRoot, file);
      if (!isWithin(destRoot, dest)) continue;
      if (isDir) {
        fs.mkdirSync(dest, { recursive: true });
        continue;
      }
      const existed = fs.existsSync(dest);
      let backupPath = null;
      if (existed) {
        backupPath = backupFn(modId, file);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(dest, backupPath);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (item.extraction) {
        fs.writeFileSync(dest, Buffer.from(item.extraction));
      } else {
        fs.writeFileSync(dest, '');
      }
      records.push({ file, dest, existed, backupPath });
    }
  }
  return records;
}

async function installMods(options) {
  const {
    gamePath,
    mods = [],
    assetsModDir,
    backupsDir,
    tier = null,
    onProgress = () => {},
    isCancelled = () => false
  } = options;

  if (!gamePath || !fs.existsSync(gamePath)) {
    return { success: false, error: 'INVALID_GAME_PATH', cancelled: false, mods: [] };
  }
  if (!Array.isArray(mods) || mods.length === 0) {
    return { success: false, error: 'NO_MODS', cancelled: false, mods: [] };
  }

  const results = [];
  const total = mods.length;
  let done = 0;

  const backupFn = (modId, rel) => path.join(backupsDir, modId, 'backup', rel + '.bak');

  for (const mod of mods) {
    if (isCancelled()) break;

    const modId = String(mod.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    if (mod.overwrite === false) {
      const skipped = {
        id: modId,
        tier: tier || mod.tier || null,
        status: 'skipped',
        installedFiles: [],
        message: 'SKIPPED_KEEP_EXISTING'
      };
      done++;
      onProgress({ done, total, mod: skipped, stage: 'skipped' });
      results.push(skipped);
      continue;
    }

    done++;

    const source = mod.source || path.join(assetsModDir, modId);
    const destRoot = resolveInside(gamePath, mod.dest || '');
    const modResult = {
      id: modId,
      tier: tier || mod.tier || null,
      status: 'pending',
      installedFiles: [],
      message: ''
    };

    if (!destRoot) {
      modResult.status = 'error';
      modResult.message = 'UNSAFE_DEST';
      onProgress({ done, total, mod: modResult, stage: 'error' });
      results.push(modResult);
      continue;
    }

    if (!fs.existsSync(source)) {
      modResult.status = 'missing';
      modResult.message = 'MISSING_FILES';
      onProgress({ done, total, mod: modResult, stage: 'missing' });
      results.push(modResult);
      continue;
    }

    try {
      onProgress({ done, total, mod: modResult, stage: 'start', message: '' });
      fs.mkdirSync(destRoot, { recursive: true });

      const type = mod.type || 'copy';
      if (type === 'extract' && (path.extname(source).toLowerCase() === '.zip' ||
          path.extname(source).toLowerCase() === '.rar' ||
          path.extname(source).toLowerCase() === '.cbr')) {
        await extractArchive(source, destRoot, modId, modResult.installedFiles, backupFn);
      } else {
        await copyDirectoryContents(source, destRoot, modId, modResult.installedFiles, backupFn);
      }

      if (modResult.installedFiles.length === 0) {
        modResult.status = 'missing';
        modResult.message = 'MISSING_FILES';
        onProgress({ done, total, mod: modResult, stage: 'missing' });
      } else {
        modResult.status = 'installed';
        modResult.message = `FILES_${modResult.installedFiles.length}`;
        onProgress({ done, total, mod: modResult, stage: 'installed' });
      }
    } catch (e) {
      modResult.status = 'error';
      modResult.message = e.message;
      onProgress({ done, total, mod: modResult, stage: 'error' });
    }

    results.push(modResult);
    await new Promise((r) => setTimeout(r, 0));
  }

  const cancelled = isCancelled();
  const hasErrors = results.some((r) => r.status === 'error');
  const hasInstalled = results.some((r) => r.status === 'installed');
  return {
    success: !cancelled && !hasErrors && hasInstalled,
    cancelled,
    mods: results
  };
}

async function uninstallFiles(files = []) {
  const results = [];
  for (const item of files) {
    const { dest, backupPath } = item || {};
    if (!dest) continue;
    try {
      if (backupPath && fs.existsSync(backupPath)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(backupPath, dest);
        fs.unlinkSync(backupPath);
        results.push({ dest, status: 'restored' });
      } else if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
        results.push({ dest, status: 'deleted' });
      } else {
        results.push({ dest, status: 'not_found' });
      }
    } catch (e) {
      results.push({ dest, status: 'error', message: e.message });
    }
  }
  return results;
}

module.exports = {
  isWithin,
  resolveInside,
  copyDirectoryContents,
  extractArchive,
  installMods,
  uninstallFiles
};
