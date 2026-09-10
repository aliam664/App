/* ------------------------------------------------------------------ */
/*  Content library core logic tests                                   */
/* ------------------------------------------------------------------ */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  scanLibrary,
  scanCars,
  scanTracks,
  classifyContent,
  findPreview,
  findCarSkins,
  findTrackLayouts,
  moveToTrash,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
  listTrash,
  previewToDataUrl,
  isSafePathInside,
  resolveSafePath,
  formatBytes,
  stringifyUiValue,
  getFolderStats
} = require('../src/lib/library');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uhm-lib-'));
const game = path.join(tmp, 'game');
const userData = path.join(tmp, 'userdata');
const trashDir = path.join(userData, 'trash');
const trashPath = path.join(userData, 'trash.json');
fs.mkdirSync(game, { recursive: true });
fs.mkdirSync(trashDir, { recursive: true });

function write(full, content) {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function setupFixture() {
  // Car: original Kunos car with metadata, preview, skins, data, sound.
  const car = path.join(game, 'content', 'cars', 'ks_ferrari_fxxk');
  write(path.join(car, 'ui', 'ui_car.json'), JSON.stringify({
    name: 'Ferrari FXX K',
    brand: 'Ferrari',
    class: 'Race',
    year: 2014,
    country: 'Italy',
    specs: { power: 860, weight: 1150, torque: 750, topSpeed: 350 },
    description: 'Track special'
  }));
  write(path.join(car, 'ui', 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write(path.join(car, 'skins', 'red', 'skin.ini'), '');
  write(path.join(car, 'skins', 'black', 'skin.ini'), '');
  write(path.join(car, 'data', 'car.json'), JSON.stringify({ brand: 'Ferrari' }));
  write(path.join(car, 'sfx', 'sound.ini'), '#sound');

  // Car: mod, no official metadata, no preview.
  const modCar = path.join(game, 'content', 'cars', 'bmw_m3_e30');
  write(path.join(modCar, 'data', 'car.json'), JSON.stringify({ name: 'BMW M3 E30', brand: 'BMW' }));
  write(path.join(modCar, 'cameras', 'camera.ini'), '');

  // Track: Kunos with layouts.
  const track = path.join(game, 'content', 'tracks', 'ks_monza');
  write(path.join(track, 'ui', 'ui_track.json'), JSON.stringify({
    name: 'Monza', country: 'Italy', city: 'Monza', length: '5.79 km', description: 'Historic circuit'
  }));
  write(path.join(track, 'ui', 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write(path.join(track, 'ui', 'layout_1', 'ui_track.json'), JSON.stringify({ name: 'Grand Prix', length: '5.79 km', country: 'Italy' }));
  write(path.join(track, 'ui', 'layout_2', 'ui_track.json'), JSON.stringify({ name: 'Junior', length: '3.3 km', country: 'Italy' }));

  // Track: mod.
  const modTrack = path.join(game, 'content', 'tracks', 'drift_city');
  write(path.join(modTrack, 'ui', 'ui_track.json'), JSON.stringify({ name: 'Drift City', country: 'Japan', length: '2.1 km' }));

  // files outside content.
  write(path.join(game, 'acs.exe'), '');
}

function setup() {
  fs.rmSync(game, { recursive: true, force: true });
  fs.rmSync(trashDir, { recursive: true, force: true });
  fs.mkdirSync(game, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  setupFixture();
}

(async () => {
  setup();

  // -- scan the library --
  const lib = scanLibrary(game);
  assert.strictEqual(lib.errors.length, 0);
  assert.strictEqual(lib.cars.length, 2);
  assert.strictEqual(lib.tracks.length, 2);

  // car metadata + preview + features
  const fxxk = lib.cars.find((c) => c.folder === 'ks_ferrari_fxxk');
  assert.ok(fxxk);
  assert.strictEqual(fxxk.name, 'Ferrari FXX K');
  assert.strictEqual(fxxk.brand, 'Ferrari');
  assert.strictEqual(fxxk.isKunos, true);
  assert.strictEqual(fxxk.isMod, false);
  assert.strictEqual(fxxk.hasPreview, true);
  assert.ok(fxxk.preview.startsWith('content/cars/ks_ferrari_fxxk/ui/preview.png'));
  assert.strictEqual(fxxk.skinCount, 2);
  assert.strictEqual(fxxk.specs.power, '860');
  assert.strictEqual(fxxk.hasData, true);
  assert.strictEqual(fxxk.hasSound, true);
  assert.ok(fxxk.sizeBytes > 0);
  assert.ok(fxxk.fileCount > 0);

  // mod car fallback name from data/car.json
  const m3 = lib.cars.find((c) => c.folder === 'bmw_m3_e30');
  assert.strictEqual(m3.name, 'BMW M3 E30');
  assert.strictEqual(m3.brand, 'BMW');
  assert.strictEqual(m3.isMod, true);
  assert.strictEqual(m3.hasPreview, false);

  // track metadata + layouts
  const monza = lib.tracks.find((t) => t.folder === 'ks_monza');
  assert.strictEqual(monza.country, 'Italy');
  assert.strictEqual(monza.layoutCount, 2);
  assert.strictEqual(monza.layouts.length, 2);
  assert.strictEqual(monza.layouts[0].name, 'Grand Prix');

  // missing game path
  const missing = scanLibrary(path.join(tmp, 'nope'));
  assert.ok(Array.isArray(missing.errors));
  assert.strictEqual(missing.errors[0], 'GAME_PATH_MISSING');

  // classification
  assert.strictEqual(classifyContent('ks_ferrari_fxxk').origin, 'kunos');
  assert.strictEqual(classifyContent('bmw_m3_e30').origin, 'mod');
  assert.strictEqual(classifyContent('bm_ferrari_458').origin, 'dlc');
  assert.strictEqual(classifyContent('ks_ferrari_fxxk').isKunos, true);
  assert.strictEqual(classifyContent('bmw_m3_e30').isMod, true);

  // findPreview picks preferred path
  const preview = findPreview(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk'), 'car');
  assert.strictEqual(preview.primary, 'ui/preview.png');
  assert.ok(preview.variants.includes('ui/preview.png'));

  // skins
  const skins = findCarSkins(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk'));
  assert.deepStrictEqual(skins, ['black', 'red']);

  // layouts
  const layouts = findTrackLayouts(path.join(game, 'content', 'tracks', 'ks_monza'));
  assert.strictEqual(layouts.length, 2);

  // preview to data url
  const url = previewToDataUrl(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk', 'ui', 'preview.png'));
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.strictEqual(previewToDataUrl(path.join(game, 'missing.png')), null);

  // path safety
  assert.ok(isSafePathInside(game, 'content/cars/ks_ferrari_fxxk/ui/preview.png'));
  assert.ok(!isSafePathInside(game, '../outside'));
  assert.ok(!isSafePathInside(game, '/etc/passwd'));
  assert.strictEqual(resolveSafePath(game, 'content/cars/x'), path.join(game, 'content', 'cars', 'x'));
  assert.strictEqual(resolveSafePath(game, '../x'), null);

  // formatBytes
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1024), '1.0 KB');
  assert.strictEqual(formatBytes(5 * 1024 * 1024), '5.0 MB');

  // -- trash: move a car, verify removed from game and tracked -- //
  const del = moveToTrash(game, 'car', 'ks_ferrari_fxxk', trashPath, trashDir);
  assert.strictEqual(del.success, true);
  assert.ok(!fs.existsSync(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk')));
  assert.ok(fs.existsSync(del.trashPath));
  const trash1 = listTrash(trashPath);
  assert.strictEqual(trash1.length, 1);
  assert.strictEqual(trash1[0].folder, 'ks_ferrari_fxxk');
  assert.strictEqual(trash1[0].existsOnDisk, true);

  // deleting again -> NOT_FOUND
  const del2 = moveToTrash(game, 'car', 'ks_ferrari_fxxk', trashPath, trashDir);
  assert.strictEqual(del2.success, false);
  assert.strictEqual(del2.error, 'NOT_FOUND');

  // invalid folder guard
  const bad = moveToTrash(game, 'car', '..', trashPath, trashDir);
  assert.strictEqual(bad.success, false);

  // -- restore -- //
  const restored = restoreTrashItem(trashPath, trash1[0].id);
  assert.strictEqual(restored.success, true);
  assert.ok(fs.existsSync(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk')));
  assert.strictEqual(listTrash(trashPath).length, 0);

  // restore missing id
  const missingRestore = restoreTrashItem(trashPath, 'nope');
  assert.strictEqual(missingRestore.success, false);

  // -- restore creates a conflict backup if target exists -- //
  const del3 = moveToTrash(game, 'car', 'ks_ferrari_fxxk', trashPath, trashDir);
  assert.strictEqual(del3.success, true);
  fs.mkdirSync(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk'), { recursive: true });
  write(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk', 'marker.txt'), 'foo');
  const restored2 = restoreTrashItem(trashPath, del3.trashId);
  assert.strictEqual(restored2.success, true);
  assert.ok(restored2.conflictPath && fs.existsSync(restored2.conflictPath));
  assert.ok(fs.existsSync(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk', 'ui', 'preview.png')));

  // -- permanent delete -- //
  const del4 = moveToTrash(game, 'track', 'drift_city', trashPath, trashDir);
  const del5 = moveToTrash(game, 'car', 'bmw_m3_e30', trashPath, trashDir);
  assert.strictEqual(del4.success, true);
  assert.strictEqual(del5.success, true);
  const list4 = listTrash(trashPath);
  const purge = permanentlyDeleteTrashItem(trashPath, list4[0].id);
  assert.strictEqual(purge.success, true);
  assert.strictEqual(listTrash(trashPath).length, 1);

  // -- empty trash -- //
  const emptied = emptyTrash(trashPath);
  assert.strictEqual(emptied.success, true);
  assert.strictEqual(listTrash(trashPath).length, 0);

  // -- stats -- //
  const stats = getFolderStats(path.join(game, 'content', 'cars', 'ks_ferrari_fxxk'));
  assert.ok(stats.sizeBytes > 0);
  assert.ok(stats.fileCount >= 1);

  // -- stringify -- //
  assert.strictEqual(stringifyUiValue('Hi'), 'Hi');
  assert.strictEqual(stringifyUiValue({ en: 'EN', it: 'IT' }), 'EN');

  console.log('LIBRARY TESTS PASSED');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('LIBRARY TEST FAILED', e); process.exit(1); });
