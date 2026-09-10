/* ------------------------------------------------------------------ */
/*  Mod installer core — drag-and-drop install (Content Manager-like)  */
/*                                                                    */
/*  A dependency-light, testable module that:                          */
/*   1. Lists the contents of a dropped source (ZIP / RAR / folder).   */
/*   2. Detects what is inside — car, track, skin, app, pp-filter,     */
/*      font, weather, driver, or a generic "mirror" of the AC root.   */
/*   3. Reads metadata (ui_car.json / ui_track.json / ui_skin.json)    */
/*      and extracts a small preview thumbnail.                        */
/*   4. Builds an install plan against the current game folder,        */
/*      including conflict analysis (new / update / already present).  */
/*   5. Executes the plan with per-file backup and progress events.    */
/*                                                                    */
/*  It never writes to the game folder during analysis — only when     */
/*  executeInstall() is called explicitly.                             */
/* ------------------------------------------------------------------ */

'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
let rar = null;

const RAR_MEMORY_CAP = 250 * 1024 * 1024; // rar archives larger than this skip in-memory metadata/preview reads
const PREVIEW_MAX_RAW = 2 * 1024 * 1024;   // largest raw preview image we bother decoding
const MAX_DEPTH = 24;

const ARCHIVE_EXTS = { '.zip': 'zip', '.rar': 'rar', '.cbr': 'rar' };
const UNSUPPORTED_EXTS = { '.7z': '7z' };

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

function normRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function leaf(p) {
  const parts = normRel(p).split('/');
  return parts[parts.length - 1] || '';
}

function parentOf(p) {
  const parts = normRel(p).split('/');
  parts.pop();
  return parts.join('/');
}

function segments(p) {
  return normRel(p).split('/').filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Source detection                                                   */
/* ------------------------------------------------------------------ */

function detectSourceKind(sourcePath) {
  if (!sourcePath) return { kind: 'invalid' };
  let stat;
  try { stat = fs.statSync(sourcePath); } catch (e) { return { kind: 'missing' }; }
  if (stat.isDirectory()) return { kind: 'folder', path: sourcePath, label: path.basename(sourcePath), sizeBytes: folderSize(sourcePath) };
  const ext = path.extname(sourcePath).toLowerCase();
  if (ARCHIVE_EXTS[ext]) return { kind: 'archive', archiveType: ARCHIVE_EXTS[ext], path: sourcePath, label: path.basename(sourcePath), sizeBytes: stat.size };
  if (UNSUPPORTED_EXTS[ext]) return { kind: 'unsupported', format: UNSUPPORTED_EXTS[ext], path: sourcePath, label: path.basename(sourcePath) };
  return { kind: 'unknown', path: sourcePath, label: path.basename(sourcePath), sizeBytes: stat.size };
}

function folderSize(dir) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) total += folderSize(full);
      else total += st.size;
    }
  } catch (e) { /* ignore */ }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Entry listing                                                      */
/* ------------------------------------------------------------------ */

function listFolderEntries(dir) {
  const out = [];
  const walk = (d, base, depth) => {
    if (depth > MAX_DEPTH) return;
    let names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const de of names) {
      const full = path.join(d, de.name);
      const rel = base ? `${base}/${de.name}` : de.name;
      if (de.isDirectory()) {
        out.push({ path: rel, isDir: true, size: 0 });
        walk(full, rel, depth + 1);
      } else if (de.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch (e) { /* ignore */ }
        out.push({ path: rel, isDir: false, size });
      }
    }
  };
  walk(dir, '', 0);
  return out;
}

function listZipEntries(file) {
  const zip = new AdmZip(file);
  return zip.getEntries().map((e) => {
    const isDir = e.isDirectory;
    const size = isDir ? 0 : (e.header && typeof e.header.size === 'number' ? e.header.size : 0);
    return { path: normRel(e.entryName), isDir, size };
  });
}

async function listRarEntries(file) {
  if (!rar) rar = require('node-unrar-js');
  const extractor = await rar.createExtractorFromFile({ filepath: file });
  const list = extractor.getFileList();
  const out = [];
  for (const h of list.fileHeaders) {
    const isDir = Boolean(h.flags && h.flags.directory);
    out.push({ path: normRel(h.name), isDir, size: isDir ? 0 : (h.unpSize || 0) });
  }
  return out;
}

async function listSourceEntries(source) {
  if (source.kind === 'folder') return listFolderEntries(source.path);
  if (source.kind === 'archive' && source.archiveType === 'zip') return listZipEntries(source.path);
  if (source.kind === 'archive' && source.archiveType === 'rar') return listRarEntries(source.path);
  return [];
}

/* ------------------------------------------------------------------ */
/*  Virtual tree                                                       */
/* ------------------------------------------------------------------ */

function buildTree(entries) {
  const dirs = new Set();
  const files = new Set();
  const fileSize = new Map();
  for (const e of entries) {
    const p = normRel(e.path);
    if (!p) continue;
    if (e.isDir) dirs.add(p);
    else {
      files.add(p);
      fileSize.set(p, e.size || 0);
    }
  }
  return { dirs, files, fileSize };
}

/* ------------------------------------------------------------------ */
/*  Content-type predicates                                            */
/* ------------------------------------------------------------------ */

function isCarDir(dirs, files, d) {
  return files.has(`${d}/ui/ui_car.json`) ||
    (dirs.has(`${d}/data`) && dirs.has(`${d}/skins`)) ||
    files.has(`${d}/data.acd`);
}

function isTrackDir(dirs, files, d) {
  return files.has(`${d}/ui/ui_track.json`) ||
    files.has(`${d}/models.ini`) ||
    files.has(`${d}/data/models.ini`) ||
    files.has(`${d}/surfaces.ini`);
}

function isSkinDir(dirs, files, d) {
  return files.has(`${d}/livery.png`) ||
    files.has(`${d}/livery.dds`) ||
    files.has(`${d}/livery.jpg`) ||
    files.has(`${d}/ui_skin.json`);
}

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

const MIRROR_ROOTS = ['content', 'system', 'apps', 'extension', 'fonts', 'driver', 'weather', 'texture'];

function detectMods(entries) {
  const tree = buildTree(entries);
  const items = [];
  const warnings = [];

  const dirsArray = [...tree.dirs];
  const dirs = tree.dirs;
  const files = tree.files;

  // Find the "content" root (mirrors the AC install root).
  let contentDir = null;
  for (const d of dirsArray) {
    if (d === 'content' || d.endsWith('/content')) { contentDir = d; break; }
  }

  // Virtual base: everything above "content/" is a wrapper folder we strip.
  let base = '';
  if (contentDir) {
    base = contentDir === 'content' ? '' : contentDir.slice(0, contentDir.length - 'content'.length);
  }
  const norm = base ? (p) => (p.startsWith(base) ? p.slice(base.length) : p) : (p) => p;
  const ndirs = new Set([...dirs].map(norm).filter(Boolean));
  const nfiles = new Set([...files].map(norm).filter(Boolean));
  const has = (p) => ndirs.has(p);
  const hasf = (p) => nfiles.has(p);

  const claimed = new Set(); // source roots already covered by a detected item

  const childDirs = (parent) => [...ndirs].filter((d) => {
    const par = parentOf(d);
    return par === parent;
  });

  const add = (item) => { items.push(item); claimed.add(normRel(item.sourceRoot)); };

  // --- Cars ---
  const carsRoot = has('content/cars') ? 'content/cars' : (has('cars') ? 'cars' : null);
  if (carsRoot) {
    for (const d of childDirs(carsRoot)) {
      if (isCarDir(ndirs, nfiles, d)) add({ type: 'car', sourceRoot: d, name: leaf(d) });
    }
  } else {
    for (const d of [...ndirs].filter((x) => segments(x).length === 1)) {
      if (isCarDir(ndirs, nfiles, d)) add({ type: 'car', sourceRoot: d, name: leaf(d) });
    }
  }

  // --- Tracks ---
  const tracksRoot = has('content/tracks') ? 'content/tracks' : (has('tracks') ? 'tracks' : null);
  if (tracksRoot) {
    for (const d of childDirs(tracksRoot)) {
      if (isTrackDir(ndirs, nfiles, d)) add({ type: 'track', sourceRoot: d, name: leaf(d) });
    }
  } else {
    for (const d of [...ndirs].filter((x) => segments(x).length === 1)) {
      if (isTrackDir(ndirs, nfiles, d)) add({ type: 'track', sourceRoot: d, name: leaf(d) });
    }
  }

  // --- Skins (standalone: not already inside a detected car) ---
  for (const d of [...ndirs]) {
    const segs = segments(d);
    if (segs.length < 2) continue;
    if (segs[segs.length - 2] !== 'skins') continue;
    const carName = segs[segs.length - 3] || '';
    if (!isSkinDir(ndirs, nfiles, d)) continue;
    const insideDetectedCar = items.some((it) => it.type === 'car' && (d === `${it.sourceRoot}/skins/${leaf(d)}` || d.startsWith(`${it.sourceRoot}/`)));
    if (insideDetectedCar) continue;
    add({ type: 'skin', sourceRoot: d, name: leaf(d), car: carName });
  }

  // --- Apps (apps/python/<name>) ---
  const appsRoots = ['apps/python', 'content/apps/python'].filter(has);
  for (const ar of appsRoots) {
    for (const d of childDirs(ar)) {
      add({ type: 'app', sourceRoot: d, name: leaf(d) });
    }
  }

  // --- PP filters (system/cfg/ppfilters/*.ini or bare ppfilters/*.ini) ---
  const ppRoots = ['system/cfg/ppfilters', 'ppfilters'].filter(has);
  const ppFiles = [];
  for (const f of nfiles) {
    for (const pr of ppRoots) {
      if (f.startsWith(`${pr}/`) && f.endsWith('.ini')) ppFiles.push(f);
    }
  }
  if (!ppRoots.length) {
    for (const f of nfiles) {
      if (segments(f).length === 1 && f.toLowerCase().endsWith('.ini')) ppFiles.push(f);
    }
  }
  if (ppFiles.length) {
    const root = ppRoots[0] || '';
    const ppNames = ppFiles.map(leaf);
    add({ type: 'ppfilter', sourceRoot: root, name: ppNames.length === 1 ? ppNames[0] : (leaf(root) || 'ppfilter'), ppFiles });
  }

  // --- Fonts / weather / driver ---
  const simpleRoots = [
    { root: has('content/fonts') ? 'content/fonts' : (has('fonts') ? 'fonts' : null), type: 'font' },
    { root: has('content/weather') ? 'content/weather' : (has('weather') ? 'weather' : null), type: 'weather' },
    { root: has('content/driver') ? 'content/driver' : (has('driver') ? 'driver' : null), type: 'driver' }
  ];
  for (const r of simpleRoots) {
    if (!r.root) continue;
    for (const d of childDirs(r.root)) {
      add({ type: r.type, sourceRoot: d, name: leaf(d) });
    }
  }

  // --- Generic mirror: any remaining files under a recognizable AC root ---
  const mirrored = [];
  for (const f of nfiles) {
    const segs = segments(f);
    if (!segs.length) continue;
    const top = segs[0];
    if (!MIRROR_ROOTS.includes(top)) continue;
    if (claimed.size) {
      const covered = [...claimed].some((c) => f === c || f.startsWith(`${c}/`));
      if (covered) continue;
    }
    mirrored.push(f);
  }
  if (mirrored.length) {
    add({ type: 'mirror', sourceRoot: '', name: 'mirror', mirrorFiles: mirrored });
  }

  if (!items.length && !mirrored.length) {
    warnings.push('NOTHING_DETECTED');
  }

  // Post-process: strip files that belong to a detected dir item.
  for (const it of items) {
    if (it.type === 'ppfilter') {
      const base = it.sourceRoot ? `${it.sourceRoot}/` : '';
      it.files = ppFiles.map((f) => ({ rel: base ? f.slice(base.length) : f, size: tree.fileSize.get(f) || 0 }));
      continue;
    }
    if (it.type === 'mirror') { it.files = it.mirrorFiles.map((f) => ({ rel: f, size: tree.fileSize.get(f) || 0 })); delete it.mirrorFiles; continue; }
    it.files = [...nfiles].filter((f) => f === it.sourceRoot || f.startsWith(`${it.sourceRoot}/`))
      .map((f) => ({ rel: f.slice(it.sourceRoot.length + 1), size: tree.fileSize.get(f) || 0 }));
  }

  return { items, warnings, root: base || null };
}

/* ------------------------------------------------------------------ */
/*  Metadata + preview reading                                         */
/* ------------------------------------------------------------------ */

function readZipFile(file, rel) {
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntries().find((e) => normRel(e.entryName) === normRel(rel));
    if (!entry || entry.isDirectory) return null;
    return entry.getData();
  } catch (e) { return null; }
}

async function readRarFiles(file, rels) {
  if (!rar) rar = require('node-unrar-js');
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return {}; }
  if (stat.size > RAR_MEMORY_CAP) return {};
  const data = fs.readFileSync(file);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const result = {};
  try {
    const extractor = await rar.createExtractorFromData({ data: buffer });
    const extract = extractor.extract({ files: rels });
    for (const item of extract.files) {
      const name = normRel(item.fileHeader.name);
      if (item.extraction) result[name] = Buffer.from(item.extraction);
    }
  } catch (e) { /* ignore */ }
  return result;
}

function readSourceFile(source, rel) {
  if (source.kind === 'folder') {
    try { return fs.readFileSync(path.join(source.path, rel)); } catch (e) { return null; }
  }
  if (source.kind === 'archive' && source.archiveType === 'zip') return readZipFile(source.path, rel);
  return null; // rar handled separately (async, batched)
}

function jsonFromBuffer(buf) {
  if (!buf) return null;
  try { return JSON.parse(buf.toString('utf-8')); } catch (e) { return null; }
}

const CAR_META = ['ui/ui_car.json'];
const TRACK_META = ['ui/ui_track.json'];
const SKIN_META = ['ui_skin.json'];

function pickMetaValue(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') {
      const s = v.en || v.EN || v.English || v['en-US'] || Object.values(v)[0];
      if (typeof s === 'string' && s.trim()) return s.trim();
    }
  }
  return '';
}

async function hydrateItems(source, detected) {
  const items = detected.items;
  // Batch rar reads in a single pass (best-effort).
  let rarBufs = {};
  if (source.kind === 'archive' && source.archiveType === 'rar') {
    const rels = [];
    for (const it of items) {
      if (it.type === 'car') rels.push(`${it.sourceRoot}/ui/ui_car.json`);
      else if (it.type === 'track') rels.push(`${it.sourceRoot}/ui/ui_track.json`);
      else if (it.type === 'skin') rels.push(`${it.sourceRoot}/ui_skin.json`);
    }
    rarBufs = await readRarFiles(source.path, rels.filter(Boolean));
  }

  for (const it of items) {
    let meta = null;
    if (it.type === 'car') {
      meta = jsonFromBuffer(source.kind === 'archive' && source.archiveType === 'rar'
        ? rarBufs[`${it.sourceRoot}/ui/ui_car.json`]
        : readSourceFile(source, `${it.sourceRoot}/ui/ui_car.json`));
      it.displayName = pickMetaValue(meta, ['name', 'Name']) || it.name;
      it.brand = pickMetaValue(meta, ['brand', 'Brand']);
      it.description = pickMetaValue(meta, ['description', 'Description']);
      it.author = pickMetaValue(meta, ['author', 'Author']);
      it.version = pickMetaValue(meta, ['version', 'Version']) || null;
    } else if (it.type === 'track') {
      meta = jsonFromBuffer(source.kind === 'archive' && source.archiveType === 'rar'
        ? rarBufs[`${it.sourceRoot}/ui/ui_track.json`]
        : readSourceFile(source, `${it.sourceRoot}/ui/ui_track.json`));
      it.displayName = pickMetaValue(meta, ['name', 'Name']) || it.name;
      it.country = pickMetaValue(meta, ['country', 'Country']);
      it.description = pickMetaValue(meta, ['description', 'Description']);
      it.author = pickMetaValue(meta, ['author', 'Author']);
      it.version = pickMetaValue(meta, ['version', 'Version']) || null;
    } else if (it.type === 'skin') {
      meta = jsonFromBuffer(source.kind === 'archive' && source.archiveType === 'rar'
        ? rarBufs[`${it.sourceRoot}/ui_skin.json`]
        : readSourceFile(source, `${it.sourceRoot}/ui_skin.json`));
      it.displayName = pickMetaValue(meta, ['name', 'Name', 'skinname', 'SkinName']) || it.name;
      it.author = pickMetaValue(meta, ['author', 'Author']);
      it.description = pickMetaValue(meta, ['description', 'Description']);
    } else {
      it.displayName = it.name;
    }

    // Preview image (best-effort, capped).
    it.preview = null;
    const previewCandidates = [];
    if (it.type === 'car') previewCandidates.push('ui/preview.jpg', 'ui/preview.png', 'ui/preview.jpeg', 'ui/preview_light.jpg', 'ui/preview_light.png');
    else if (it.type === 'track') previewCandidates.push('ui/preview.jpg', 'ui/preview.png', 'ui/preview.jpeg', 'ui/preview_light.jpg', 'ui/preview_light.png');
    else if (it.type === 'skin') previewCandidates.push('preview.jpg', 'preview.png', 'preview.jpeg', 'livery.png');
    for (const rel of previewCandidates) {
      const full = `${it.sourceRoot}/${rel}`;
      let buf = null;
      if (source.kind === 'archive' && source.archiveType === 'rar') buf = rarBufs[full] || null;
      else buf = readSourceFile(source, full);
      if (buf && buf.length > 0 && buf.length <= PREVIEW_MAX_RAW) {
        const ext = path.extname(rel).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        it.preview = { mime, base64: buf.toString('base64') };
        break;
      }
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/*  Install plan (targets + conflicts)                                 */
/* ------------------------------------------------------------------ */

function targetFor(gamePath, item) {
  switch (item.type) {
    case 'car': return path.join(gamePath, 'content', 'cars', item.name);
    case 'track': return path.join(gamePath, 'content', 'tracks', item.name);
    case 'skin': return path.join(gamePath, 'content', 'cars', item.car || '', 'skins', item.name);
    case 'app': return path.join(gamePath, 'apps', 'python', item.name);
    case 'ppfilter': return path.join(gamePath, 'system', 'cfg', 'ppfilters');
    case 'font': return path.join(gamePath, 'content', 'fonts', item.name);
    case 'weather': return path.join(gamePath, 'content', 'weather', item.name);
    case 'driver': return path.join(gamePath, 'content', 'driver', item.name);
    case 'mirror': return gamePath;
    default: return null;
  }
}

function targetRelative(item) {
  switch (item.type) {
    case 'car': return `content/cars/${item.name}`;
    case 'track': return `content/tracks/${item.name}`;
    case 'skin': return `content/cars/${item.car || ''}/skins/${item.name}`;
    case 'app': return `apps/python/${item.name}`;
    case 'ppfilter': return 'system/cfg/ppfilters';
    case 'font': return `content/fonts/${item.name}`;
    case 'weather': return `content/weather/${item.name}`;
    case 'driver': return `content/driver/${item.name}`;
    case 'mirror': return '<game root>';
    default: return '';
  }
}

function listDiskFiles(dir, depth = 0) {
  const out = new Set();
  if (depth > MAX_DEPTH) return out;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const de of names) {
    const full = path.join(dir, de.name);
    if (de.isDirectory()) {
      for (const f of listDiskFiles(full, depth + 1)) out.add(`${de.name}/${f}`.replace(/^\/+/, ''));
    } else if (de.isFile()) {
      out.add(de.name);
    }
  }
  return out;
}

function buildPlan(gamePath, items) {
  for (const it of items) {
    it.targetDir = targetFor(gamePath, it);
    it.targetRelative = targetRelative(it);
    it.fileCount = (it.files || []).length;
    it.sizeBytes = (it.files || []).reduce((s, f) => s + (f.size || 0), 0);

    it.status = 'new';
    it.overwriteCount = 0;
    it.addCount = 0;

    if (it.targetDir && fs.existsSync(it.targetDir)) {
      const existing = listDiskFiles(it.targetDir);
      const incoming = new Set((it.files || []).map((f) => normRel(f.rel)));
      let overwrite = 0;
      for (const rel of incoming) {
        if (existing.has(rel)) overwrite += 1;
      }
      const add = incoming.size - overwrite;
      it.overwriteCount = overwrite;
      it.addCount = add;
      it.status = overwrite === 0 && add === 0 ? 'same' : 'update';
    } else {
      it.addCount = (it.files || []).length;
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

async function extractToStaging(source, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  if (source.kind === 'folder') return source.path; // already on disk
  if (source.kind === 'archive' && source.archiveType === 'zip') {
    const zip = new AdmZip(source.path);
    zip.extractAllTo(stagingDir, true);
    return stagingDir;
  }
  if (source.kind === 'archive' && source.archiveType === 'rar') {
    if (!rar) rar = require('node-unrar-js');
    const extractor = await rar.createExtractorFromFile({ filepath: source.path, targetPath: stagingDir });
    extractor.extract({ files: [] });
    return stagingDir;
  }
  return null;
}

function copyWithBackup(srcFile, destFile, backupFn, id) {
  let existed = false;
  let backupPath = null;
  if (fs.existsSync(destFile)) {
    existed = true;
    backupPath = backupFn(id, destFile);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(destFile, backupPath);
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(srcFile, destFile);
  return { existed, backupPath };
}

async function executeInstall(source, items, options = {}) {
  const {
    gamePath = '',
    backupsDir,
    onProgress = () => {},
    isCancelled = () => false
  } = options;

  if (!gamePath || !fs.existsSync(gamePath)) {
    return { success: false, error: 'INVALID_GAME_PATH', cancelled: false, items: [] };
  }
  if (!items || !items.length) {
    return { success: false, error: 'NO_ITEMS', cancelled: false, items: [] };
  }

  const stamp = Date.now();
  const stagingRoot = path.join(gamePath, '.uhm-staging', String(stamp));
  const stagingBase = await extractToStaging(source, stagingRoot);
  if (!stagingBase) {
    return { success: false, error: 'EXTRACT_FAILED', cancelled: false, items: [] };
  }

  const backupFn = (id, destFile) => {
    const rel = path.relative(gamePath, destFile).split(path.sep).join('/');
    return path.join(backupsDir, String(id), 'backup', `${rel}.bak`);
  };

  const results = [];
  const total = items.length;
  let done = 0;
  let cancelled = false;

  try {
    for (const it of items) {
      if (isCancelled()) { cancelled = true; break; }
      done += 1;
      const result = {
        id: it.id,
        type: it.type,
        name: it.name,
        status: 'pending',
        installedFiles: [],
        error: null
      };
      onProgress({ done, total, item: result, stage: 'start' });

      try {
        const srcRoot = it.sourceRoot ? path.join(stagingBase, it.sourceRoot) : stagingBase;
        for (const f of it.files || []) {
          if (isCancelled()) { cancelled = true; break; }
          const rel = normRel(f.rel);
          const srcFile = path.join(srcRoot, rel);
          const destFile = path.join(it.targetDir, rel);
          if (!fs.existsSync(srcFile)) continue;
          const r = copyWithBackup(srcFile, destFile, backupFn, it.id);
          result.installedFiles.push({ rel, dest: destFile, existed: r.existed, backupPath: r.backupPath });
        }
        result.status = cancelled ? 'skipped' : 'installed';
      } catch (e) {
        result.status = 'error';
        result.error = e.message;
      }
      onProgress({ done, total, item: result, stage: result.status });
      results.push(result);
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    // Best-effort cleanup of the staging area.
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  const hasErrors = results.some((r) => r.status === 'error');
  const installedCount = results.filter((r) => r.status === 'installed').length;
  return {
    success: !cancelled && !hasErrors && installedCount > 0,
    cancelled,
    error: cancelled ? 'CANCELLED' : hasErrors ? 'SOME_FAILED' : null,
    installedCount,
    items: results
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

async function analyzeSource(sourcePath, gamePath) {
  const source = detectSourceKind(sourcePath);
  if (source.kind === 'invalid' || source.kind === 'missing') {
    return { ok: false, error: 'SOURCE_MISSING', source: { label: path.basename(sourcePath || '') } };
  }
  if (source.kind === 'unsupported') {
    return { ok: false, error: 'UNSUPPORTED_FORMAT', format: source.format, source };
  }
  if (source.kind === 'unknown') {
    return { ok: false, error: 'UNSUPPORTED_FORMAT', format: path.extname(sourcePath) || 'unknown', source };
  }

  let entries;
  try {
    entries = await listSourceEntries(source);
  } catch (e) {
    return { ok: false, error: 'READ_FAILED', source };
  }

  const detected = detectMods(entries);
  let items = await hydrateItems(source, detected);
  if (gamePath && typeof gamePath === 'string') {
    items = buildPlan(gamePath, items);
  } else {
    items.forEach((it) => { it.targetDir = null; it.targetRelative = targetRelative(it); it.fileCount = (it.files || []).length; it.sizeBytes = (it.files || []).reduce((s, f) => s + (f.size || 0), 0); it.status = 'new'; it.overwriteCount = 0; it.addCount = (it.files || []).length; });
  }

  const totalSize = (items || []).reduce((s, it) => s + (it.sizeBytes || 0), 0);
  return {
    ok: true,
    source: {
      label: source.label,
      kind: source.kind,
      archiveType: source.archiveType || null,
      sizeBytes: source.sizeBytes || totalSize || 0,
      entryCount: entries.length
    },
    items,
    warnings: detected.warnings,
    totalSize,
    totalItems: items.length
  };
}

module.exports = {
  detectSourceKind,
  listSourceEntries,
  listFolderEntries,
  listZipEntries,
  listRarEntries,
  buildTree,
  detectMods,
  buildPlan,
  executeInstall,
  analyzeSource,
  isCarDir,
  isTrackDir,
  isSkinDir,
  targetFor,
  targetRelative
};
