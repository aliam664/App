/* ================================================================= */
/*  UHM Content Library — core logic (main-process)                  */
/*                                                                    */
/*  A dependency-light, fully testable module that scans Assetto      */
/*  Corsa `content/cars` and `content/tracks`, extracts metadata     */
/*  and preview images, and manages a safe soft-delete trash store.  */
/*  It never writes to the game folder except when the user asks     */
/*  to delete or restore an item, and it always guards against       */
/*  path traversal and deleting critical roots.                      */
/* ================================================================= */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CONTENT_DIR = 'content';
const CARS_DIR = 'cars';
const TRACKS_DIR = 'tracks';

/* Ordered by preference. `.jpeg` is included explicitly because many
   community mods ship `ui/preview.jpeg` (and Windows is case-insensitive,
   but the explicit entry also keeps browser/preview parity). */
const CAR_PREVIEW_CANDIDATES = [
  'ui/preview.png',
  'ui/preview.jpg',
  'ui/preview.jpeg',
  'ui/preview_light.png',
  'ui/preview_light.jpg',
  'ui/preview_light.jpeg',
  'ui/preview_2.png',
  'ui/preview_2.jpg',
  'ui/preview_2.jpeg',
  'preview.png',
  'preview.jpg',
  'preview.jpeg',
  'ui/ui_preview.jpg'
];

const TRACK_PREVIEW_CANDIDATES = [
  'ui/preview.png',
  'ui/preview.jpg',
  'ui/preview.jpeg',
  'ui/preview_light.png',
  'ui/preview_light.jpg',
  'ui/preview_light.jpeg',
  'preview.png',
  'preview.jpg',
  'preview.jpeg',
  'ui/ui_preview.jpg',
  'ui/preview_2.png',
  'ui/preview_2.jpg',
  'ui/preview_2.jpeg'
];

const LAYOUT_FOLDER_RE = /^layout_\d+$/i;

/* Only a handful of non-`ks_` prefixes correspond to known official
   Assetto Corsa DLC content. Everything else with a non-`ks_` folder
   is treated as a user mod, which is the safe default. */
const KNOWN_DLC_PREFIXES = /^(bm_|am_|truck_|kart_|mclaren_|lotus_|gtr_|csr_|dr_)/i;

/* ------------------------------------------------------------------ */
/*  Small file helpers (silent)                                        */
/* ------------------------------------------------------------------ */

function readJsonSilent(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function stringifyUiValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return String(
      value.en || value.EN || value.English || value['en-US'] || value.ENGLISH || value.italian ||
      value.it || value.zh || value.ko || value.jp || value.ru || value.fr || value.de || value.es ||
      Object.values(value)[0] || ''
    ).trim();
  }
  if (value == null) return '';
  return String(value).trim();
}

function stringifyNumberOrUnit(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    for (const k of keys) {
      if (typeof value[k] === 'number' || typeof value[k] === 'string') {
        return `${value[k]}${k}`;
      }
    }
    return stringifyUiValue(value);
  }
  return '';
}

function safeLeaf(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function listContentFolders(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/* ------------------------------------------------------------------ */
/*  Path safety                                                        */
/* ------------------------------------------------------------------ */

function isSafePathInside(base, rel) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(base, rel || '');
  const relToBase = path.relative(resolvedBase, resolved);
  return resolved === resolvedBase || (
    relToBase !== '' &&
    !relToBase.startsWith('..') &&
    !path.isAbsolute(relToBase)
  );
}

function resolveSafePath(base, rel, allowRoot = false) {
  if (!rel) return null;
  const resolved = path.resolve(base, rel);
  const relToBase = path.relative(path.resolve(base), resolved);
  const safe = relToBase === '' ? allowRoot : (!relToBase.startsWith('..') && !path.isAbsolute(relToBase));
  return safe ? resolved : null;
}

/* ------------------------------------------------------------------ */
/*  Folder statistics                                                  */
/* ------------------------------------------------------------------ */

/* Async walk so a big library never freezes the main process / UI.
   The event loop is yielded every `YIELD_EVERY` entries so rendering
   (window drag, animations, progress updates) stays responsive. */
const YIELD_EVERY = 128;

async function walkStats(dir, depth = 0) {
  const result = { sizeBytes: 0, fileCount: 0 };
  if (depth > 12) return result;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return result;
  }
  let i = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const child = await walkStats(full, depth + 1);
        result.sizeBytes += child.sizeBytes;
        result.fileCount += child.fileCount;
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(full);
        result.sizeBytes += stat.size;
        result.fileCount += 1;
      }
    } catch (e) { /* skip unreadable files */ }
    i += 1;
    if ((i & (YIELD_EVERY - 1)) === 0) await new Promise((r) => setImmediate(r));
  }
  return result;
}

async function getFolderStats(dir) {
  let modifiedAt = null;
  try {
    const stat = await fs.promises.stat(dir);
    modifiedAt = stat.mtime.toISOString();
  } catch (e) { /* ignore */ }
  const stats = await walkStats(dir);
  return { ...stats, modifiedAt };
}

/* ------------------------------------------------------------------ */
/*  Preview / skin / layout discovery                                  */
/* ------------------------------------------------------------------ */

function findPreview(baseDir, type) {
  const candidates = type === 'car' ? CAR_PREVIEW_CANDIDATES : TRACK_PREVIEW_CANDIDATES;
  const found = [];
  for (const rel of candidates) {
    const full = path.join(baseDir, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      found.push({ rel, full, ext: path.extname(full).toLowerCase() });
    }
  }
  const primary = found.length ? found[0] : null;
  const variants = found.map((f) => f.rel);
  return {
    primary: primary ? primary.rel.replace(/\\/g, '/') : null,
    variants: variants.map((v) => v.replace(/\\/g, '/')),
    baseDir: baseDir.replace(/\\/g, '/')
  };
}

function findCarSkins(carDir) {
  const skinsDir = path.join(carDir, 'skins');
  if (!fs.existsSync(skinsDir)) return [];
  return fs.readdirSync(skinsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/* Many community mods do NOT ship a global `ui/preview.*` image — their
   preview lives only inside a skin folder (`skins/<name>/preview.jpg`).
   Fall back to the first skin preview so these cars still show a thumbnail
   instead of a grey placeholder. */
function findCarPreview(carDir) {
  const direct = findPreview(carDir, 'car');
  if (direct.primary) return { ...direct, source: 'ui' };

  const skinsDir = path.join(carDir, 'skins');
  if (fs.existsSync(skinsDir)) {
    for (const skin of findCarSkins(carDir)) {
      const found = findPreview(path.join(skinsDir, skin), 'car');
      if (found.primary) {
        return {
          primary: path.posix.join('skins', skin, found.primary),
          variants: found.variants.map((v) => path.posix.join('skins', skin, v)),
          baseDir: carDir.replace(/\\/g, '/'),
          source: 'skin'
        };
      }
    }
  }
  return { ...direct, source: null };
}

function findTrackLayouts(trackDir) {
  const uiDir = path.join(trackDir, 'ui');
  if (!fs.existsSync(uiDir)) return [];
  const dirs = fs.readdirSync(uiDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && LAYOUT_FOLDER_RE.test(e.name))
    .map((e) => e.name);
  const layouts = [];
  for (const layoutFolder of dirs) {
    const layoutDir = path.join(uiDir, layoutFolder);
    const uiTrack = readJsonSilent(path.join(layoutDir, 'ui_track.json')) || {};
    const im = readJsonSilent(path.join(layoutDir, 'im.ini')) || null;
    layouts.push({
      folder: layoutFolder,
      name: stringifyUiValue(uiTrack.name) || layoutFolder,
      country: stringifyUiValue(uiTrack.country),
      city: stringifyUiValue(uiTrack.city),
      length: stringifyNumberOrUnit(uiTrack.length),
      hasInfo: Boolean(im),
      preview: findPreview(layoutDir, 'track').primary
    });
  }
  return layouts.sort((a, b) => a.folder.localeCompare(b.folder));
}

/* ------------------------------------------------------------------ */
/*  Metadata extraction                                                */
/* ------------------------------------------------------------------ */

function extractCarMeta(ui, carDir) {
  const uiPath = path.join(carDir, 'ui', 'ui_car.json');
  const carJson = readJsonSilent(path.join(carDir, 'data', 'car.json')) || {};
  const specs = (ui && (ui.specs || ui.Specs)) || {};

  const powerValue = stringifyNumberOrUnit(specs.power || specs.hp || specs.POWER || specs.HP);
  const weightValue = stringifyNumberOrUnit(specs.weight || specs.mass || specs.WEIGHT);
  const torqueValue = stringifyNumberOrUnit(specs.torque || specs.NM || specs.Nm);
  const topSpeedValue = stringifyNumberOrUnit(specs.topSpeed || specs.topspeed || specs['top speed']);

  return {
    name: stringifyUiValue(ui.name) || stringifyUiValue(carJson.name) || path.basename(carDir),
    brand: stringifyUiValue(ui.brand) || stringifyUiValue(carJson.brand),
    klass: stringifyUiValue(ui['class'] || ui._class || ui.carClass || carJson['class']),
    year: stringifyNumberOrUnit(ui.year || carJson.year),
    country: stringifyUiValue(ui.country || carJson.country),
    description: stringifyUiValue(ui.description || carJson.description),
    specs: {
      power: powerValue,
      torque: torqueValue,
      weight: weightValue,
      topSpeed: topSpeedValue
    },
    hasSpecs: Boolean(powerValue || torqueValue || weightValue || topSpeedValue),
    uiPath: uiPath.replace(/\\/g, '/'),
    hasUi: Boolean(fs.existsSync(uiPath))
  };
}

function extractTrackMeta(ui) {
  return {
    name: stringifyUiValue(ui.name),
    country: stringifyUiValue(ui.country),
    city: stringifyUiValue(ui.city),
    location: stringifyUiValue(ui.location) || stringifyUiValue(ui.region),
    length: stringifyNumberOrUnit(ui.length),
    width: stringifyNumberOrUnit(ui.width),
    description: stringifyUiValue(ui.description),
    hasUi: Boolean(ui)
  };
}

/* ------------------------------------------------------------------ */
/*  Classification                                                     */
/* ------------------------------------------------------------------ */

function classifyContent(folder, type) {
  const lower = String(folder || '').toLowerCase();
  const isKunos = /^ks_/.test(lower);
  const isDlc = !isKunos && KNOWN_DLC_PREFIXES.test(lower);
  const isMod = !isKunos && !isDlc;
  return { isKunos, isDlc, isMod, origin: isKunos ? 'kunos' : isDlc ? 'dlc' : 'mod' };
}

/* ------------------------------------------------------------------ */
/*  Car / track scanning                                               */
/* ------------------------------------------------------------------ */

async function scanCars(gamePath, onProgress) {
  const carsRoot = path.join(gamePath, CONTENT_DIR, CARS_DIR);
  const folders = listContentFolders(carsRoot);
  const result = [];
  for (let i = 0; i < folders.length; i += 1) {
    const folder = folders[i];
    const carDir = path.join(carsRoot, folder);
    const ui = readJsonSilent(path.join(carDir, 'ui', 'ui_car.json')) || {};
    const meta = extractCarMeta(ui, carDir);
    const preview = findCarPreview(carDir);
    const stats = await getFolderStats(carDir);
    const skins = findCarSkins(carDir);
    const hasData = fs.existsSync(path.join(carDir, 'data'));
    const hasSound = fs.existsSync(path.join(carDir, 'sfx'));
    const hasCamera = fs.existsSync(path.join(carDir, 'cameras'));
    const cls = classifyContent(folder, 'car');

    result.push({
      type: 'car',
      id: `car:${folder}`,
      folder,
      ...meta,
      preview: preview.primary ? path.join(CONTENT_DIR, CARS_DIR, folder, preview.primary).replace(/\\/g, '/') : null,
      previewVariants: preview.variants,
      hasPreview: Boolean(preview.primary),
      isKunos: cls.isKunos,
      isDlc: cls.isDlc,
      isMod: cls.isMod,
      origin: cls.origin,
      skinCount: skins.length,
      skins: skins.slice(0, 20),
      hasData,
      hasSound,
      hasCamera,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      modifiedAt: stats.modifiedAt
    });

    if (onProgress) onProgress({ phase: 'cars', done: i + 1, total: folders.length, folder });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

async function scanTracks(gamePath, onProgress) {
  const tracksRoot = path.join(gamePath, CONTENT_DIR, TRACKS_DIR);
  const folders = listContentFolders(tracksRoot);
  const result = [];
  for (let i = 0; i < folders.length; i += 1) {
    const folder = folders[i];
    const trackDir = path.join(tracksRoot, folder);
    const ui = readJsonSilent(path.join(trackDir, 'ui', 'ui_track.json')) || {};
    const meta = extractTrackMeta(ui);
    const preview = findPreview(trackDir, 'track');
    const stats = await getFolderStats(trackDir);
    const layouts = findTrackLayouts(trackDir);
    const hasModels = fs.existsSync(path.join(trackDir, 'models.ini')) || fs.existsSync(path.join(trackDir, 'data', 'models.ini'));
    const cls = classifyContent(folder, 'track');

    result.push({
      type: 'track',
      id: `track:${folder}`,
      folder,
      ...meta,
      preview: preview.primary ? path.join(CONTENT_DIR, TRACKS_DIR, folder, preview.primary).replace(/\\/g, '/') : null,
      previewVariants: preview.variants,
      hasPreview: Boolean(preview.primary),
      isKunos: cls.isKunos,
      isDlc: cls.isDlc,
      isMod: cls.isMod,
      origin: cls.origin,
      layoutCount: Math.max(layouts.length, 1),
      layouts,
      hasModels,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      modifiedAt: stats.modifiedAt
    });

    if (onProgress) onProgress({ phase: 'tracks', done: i + 1, total: folders.length, folder });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}

async function scanLibrary(gamePath, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  if (!gamePath || typeof gamePath !== 'string' || !fs.existsSync(gamePath)) {
    return {
      gameRoot: null,
      contentRoot: null,
      cars: [],
      tracks: [],
      errors: ['GAME_PATH_MISSING']
    };
  }
  const contentRoot = path.join(gamePath, CONTENT_DIR);
  const cars = await scanCars(gamePath, onProgress);
  const tracks = await scanTracks(gamePath, onProgress);
  return {
    gameRoot: gamePath,
    contentRoot,
    cars,
    tracks,
    errors: []
  };
}

/* ------------------------------------------------------------------ */
/*  Filter / search / sort (pure — used by renderer too)               */
/* ------------------------------------------------------------------ */

function matchesSearch(item, term) {
  if (!term) return true;
  const q = String(term).trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.name, item.folder, item.brand, item['class'], item.country,
    item.city, item.location, item.klass, item.origin, item.year,
    ...(item.layouts || []).map((l) => l.name)
  ].filter(Boolean).map(String).join(' ').toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

function filterLibrary(items, options = {}) {
  const search = options.search || '';
  const type = options.type || 'all';
  const origin = options.origin || 'all';
  const withPreview = options.withPreview ? Boolean(options.withPreview) : false;
  const onlyMods = Boolean(options.modsOnly);
  const country = options.country || 'all';
  const brand = options.brand || 'all';

  return items.filter((item) => {
    if (type !== 'all' && item.type !== type) return false;
    if (origin === 'mod' && !item.isMod) return false;
    if (origin === 'kunos' && !item.isKunos) return false;
    if (origin === 'dlc' && !item.isDlc) return false;
    if (withPreview && !item.hasPreview) return false;
    if (onlyMods && !item.isMod) return false;
    if (country !== 'all' && item.country !== country) return false;
    if (brand !== 'all' && item.brand !== brand) return false;
    return matchesSearch(item, search);
  });
}

function sortLibrary(items, key = 'name', dir = 'asc') {
  const fn = key === 'size' ? (a, b) => a.sizeBytes - b.sizeBytes
    : key === 'date' ? (a, b) => (a.modifiedAt || '').localeCompare(b.modifiedAt || '')
    : key === 'type' ? (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    : key === 'origin' ? (a, b) => a.origin.localeCompare(b.origin) || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name, 'fa');
  return [...items].sort((a, b) => dir === 'desc' ? fn(b, a) : fn(a, b));
}

function collectFacets(items) {
  const countries = new Set();
  const brands = new Set();
  const origins = new Set();
  for (const item of items) {
    if (item.country) countries.add(item.country);
    if (item.brand) brands.add(item.brand);
    if (item.origin) origins.add(item.origin);
  }
  return {
    countries: [...countries].sort((a, b) => a.localeCompare(b)),
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
    origins: [...origins].sort()
  };
}

/* ------------------------------------------------------------------ */
/*  Trash manager                                                      */
/* ------------------------------------------------------------------ */

function loadTrash(trashPath) {
  const data = readJsonSilent(trashPath);
  return Array.isArray(data) ? data : [];
}

function saveTrash(trashPath, list) {
  writeJsonAtomic(trashPath, list);
}

function trashTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function contentRootFor(gamePath, contentType) {
  if (!gamePath || typeof gamePath !== 'string') return null;
  if (contentType === 'car') return path.join(gamePath, CONTENT_DIR, CARS_DIR);
  if (contentType === 'track') return path.join(gamePath, CONTENT_DIR, TRACKS_DIR);
  return null;
}

async function moveToTrash(gamePath, contentType, folder, trashPath, trashDir) {
  const contentRoot = contentRootFor(gamePath, contentType);
  if (!contentRoot) return { success: false, error: 'INVALID_TYPE' };
  if (!folder || typeof folder !== 'string' || folder.includes('..') || path.isAbsolute(folder)) {
    return { success: false, error: 'INVALID_FOLDER' };
  }
  const source = path.join(contentRoot, folder);
  if (!fs.existsSync(source)) return { success: false, error: 'NOT_FOUND' };

  // Never allow deleting the whole content root or critical dirs.
  const rel = path.relative(contentRoot, source);
  if (rel === '' || rel.startsWith('..')) return { success: false, error: 'INVALID_FOLDER' };

  const stamp = trashTimestamp();
  const trashRoot = path.join(trashDir, `${stamp}_${safeLeaf(folder)}`);
  try {
    fs.mkdirSync(path.dirname(trashRoot), { recursive: true });
    // Async copy/remove so moving a large content folder never blocks the
    // main process (and therefore the window) for seconds.
    await fs.promises.cp(source, trashRoot, { recursive: true });
    await fs.promises.rm(source, { recursive: true, force: true });

    const trash = loadTrash(trashPath);
    const cls = classifyContent(folder, contentType);
    trash.unshift({
      id: `${stamp}_${safeLeaf(folder)}`,
      type: contentType,
      folder,
      originalPath: source,
      trashPath: trashRoot,
      deletedAt: new Date().toISOString(),
      isKunos: cls.isKunos,
      isDlc: cls.isDlc,
      isMod: cls.isMod,
      origin: cls.origin
    });
    saveTrash(trashPath, trash);
    return { success: true, trashId: trash[0].id, trashPath: trashRoot };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function restoreTrashItem(trashPath, trashId) {
  const trash = loadTrash(trashPath);
  const entry = trash.find((t) => t.id === trashId);
  if (!entry) return { success: false, error: 'NOT_FOUND' };
  if (entry.trashPath && !fs.existsSync(entry.trashPath)) return { success: false, error: 'TRASH_MISSING' };

  try {
    const target = entry.originalPath;
    const targetParent = path.dirname(target);
    fs.mkdirSync(targetParent, { recursive: true });

    // If a directory already exists at the target, preserve it as a conflict backup
    // instead of silently overwriting or losing the moved content.
    let conflictPath = null;
    if (fs.existsSync(target)) {
      conflictPath = `${target}.trash-conflict-${Date.now()}`;
      await fs.promises.cp(target, conflictPath, { recursive: true });
      await fs.promises.rm(target, { recursive: true, force: true });
    }

    await fs.promises.cp(entry.trashPath, target, { recursive: true });
    await fs.promises.rm(entry.trashPath, { recursive: true, force: true });
    saveTrash(trashPath, trash.filter((t) => t.id !== trashId));
    return { success: true, conflictPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function permanentlyDeleteTrashItem(trashPath, trashId) {
  const trash = loadTrash(trashPath);
  const entry = trash.find((t) => t.id === trashId);
  if (!entry) return { success: false, error: 'NOT_FOUND', deleted: [] };
  try {
    if (entry.trashPath && fs.existsSync(entry.trashPath)) {
      await fs.promises.rm(entry.trashPath, { recursive: true, force: true });
    }
    saveTrash(trashPath, trash.filter((t) => t.id !== trashId));
    return { success: true, deleted: [entry.folder] };
  } catch (e) {
    return { success: false, error: e.message, deleted: [] };
  }
}

async function emptyTrash(trashPath) {
  const trash = loadTrash(trashPath);
  const deleted = [];
  let error = null;
  for (const entry of trash) {
    try {
      if (entry.trashPath && fs.existsSync(entry.trashPath)) {
        await fs.promises.rm(entry.trashPath, { recursive: true, force: true });
      }
      deleted.push(entry.folder);
    } catch (e) {
      error = e.message;
    }
  }
  saveTrash(trashPath, []);
  return { success: true, deleted, error };
}

function listTrash(trashPath) {
  return loadTrash(trashPath).map((t) => ({
    id: t.id,
    type: t.type,
    folder: t.folder,
    originalPath: t.originalPath,
    trashPath: t.trashPath,
    deletedAt: t.deletedAt,
    isKunos: Boolean(t.isKunos),
    isDlc: Boolean(t.isDlc),
    isMod: Boolean(t.isMod),
    origin: t.origin || (t.isKunos ? 'kunos' : t.isDlc ? 'dlc' : 'mod'),
    existsOnDisk: Boolean(t.trashPath && fs.existsSync(t.trashPath))
  }));
}

/* ------------------------------------------------------------------ */
/*  Preview reading                                                    */
/* ------------------------------------------------------------------ */

function previewToDataUrl(fullPath, maxBytes = 900 * 1024) {
  try {
    if (!fs.existsSync(fullPath)) return null;
    const ext = path.extname(fullPath).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : ext === '.bmp' ? 'image/bmp'
      : 'image/png';
    const stat = fs.statSync(fullPath);
    if (stat.size > maxBytes) return { tooLarge: true };
    const buf = fs.readFileSync(fullPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Stats helpers                                                      */
/* ------------------------------------------------------------------ */

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.abs(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = {
  CONTENT_DIR,
  CARS_DIR,
  TRACKS_DIR,
  readJsonSilent,
  stringifyUiValue,
  stringifyNumberOrUnit,
  safeLeaf,
  isSafePathInside,
  resolveSafePath,
  listContentFolders,
  walkStats,
  getFolderStats,
  findPreview,
  findCarPreview,
  findCarSkins,
  findTrackLayouts,
  extractCarMeta,
  extractTrackMeta,
  classifyContent,
  scanCars,
  scanTracks,
  scanLibrary,
  matchesSearch,
  filterLibrary,
  sortLibrary,
  collectFacets,
  loadTrash,
  saveTrash,
  moveToTrash,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
  listTrash,
  previewToDataUrl,
  formatBytes
};
