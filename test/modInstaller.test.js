const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  detectSourceKind,
  listFolderEntries,
  detectMods,
  buildPlan,
  executeInstall,
  analyzeSource,
  targetRelative
} = require('../src/lib/modInstaller');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uhm-modinstall-'));
  const game = path.join(tmp, 'game');
  const backups = path.join(tmp, 'backups');
  fs.mkdirSync(path.join(game, 'content'), { recursive: true });
  fs.mkdirSync(backups, { recursive: true });

  function write(p, content) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }

  /* ===================================================================
     1) source kind detection
     =================================================================== */
  {
    const dir = path.join(tmp, 'folder_src');
    fs.mkdirSync(dir, { recursive: true });
    write(path.join(dir, 'x.txt'), 'x');
    write(path.join(tmp, 'a.7z'), 'x');
    write(path.join(tmp, 'a.bin'), 'x');
    assert.strictEqual(detectSourceKind(dir).kind, 'folder');
    assert.strictEqual(detectSourceKind(path.join(tmp, 'nope.zip')).kind, 'missing');
    assert.strictEqual(detectSourceKind(path.join(tmp, 'a.7z')).kind, 'unsupported');
    assert.strictEqual(detectSourceKind(path.join(tmp, 'a.bin')).kind, 'unknown');
  }

  /* ===================================================================
     2) detection of a mixed content archive
     =================================================================== */
  {
    const src = path.join(tmp, 'mixed');
    write(path.join(src, 'content', 'cars', 'my_car', 'ui', 'ui_car.json'), '{"name":"My Car","brand":"MyBrand"}');
    write(path.join(src, 'content', 'cars', 'my_car', 'data.acd'), 'ACD');
    write(path.join(src, 'content', 'cars', 'my_car', 'skins', 'red', 'livery.png'), 'png');
    write(path.join(src, 'content', 'tracks', 'my_track', 'ui', 'ui_track.json'), '{"name":"My Track"}');
    write(path.join(src, 'content', 'tracks', 'my_track', 'models.ini'), '[MODEL]');
    write(path.join(src, 'content', 'cars', 'other_car', 'skins', 'blue', 'ui_skin.json'), '{"name":"Blue"}');
    write(path.join(src, 'content', 'cars', 'other_car', 'skins', 'blue', 'livery.png'), 'png');
    write(path.join(src, 'apps', 'python', 'myapp', 'myapp.py'), 'print(1)');
    write(path.join(src, 'system', 'cfg', 'ppfilters', 'uhm_filter.ini'), '[FOG]');
    write(path.join(src, 'content', 'fonts', 'myfont', 'myfont.txt'), 'font');

    const entries = listFolderEntries(src);
    const { items } = detectMods(entries);

    const byType = {};
    for (const it of items) byType[it.type] = it;

    assert.ok(byType.car, 'car detected');
    assert.strictEqual(byType.car.name, 'my_car');
    assert.ok(byType.track, 'track detected');
    assert.strictEqual(byType.track.name, 'my_track');
    assert.ok(byType.skin, 'standalone skin detected');
    assert.strictEqual(byType.skin.car, 'other_car');
    assert.ok(byType.app, 'app detected');
    assert.strictEqual(byType.app.name, 'myapp');
    assert.ok(byType.ppfilter, 'pp filter detected');
    assert.ok(byType.ppfilter.files.some((f) => f.rel === 'uhm_filter.ini'));
    assert.ok(byType.font, 'font detected');

    // The car's own skin must NOT be a separate item.
    assert.ok(!items.some((it) => it.type === 'skin' && it.name === 'red'), 'car skin must not be double-detected');

    const carFiles = byType.car.files.map((f) => f.rel).sort();
    assert.deepStrictEqual(carFiles, ['data.acd', 'skins/red/livery.png', 'ui/ui_car.json']);
  }

  /* ===================================================================
     3) plan conflict analysis
     =================================================================== */
  {
    const carDir = path.join(game, 'content', 'cars', 'plan_car');
    write(path.join(carDir, 'ui', 'ui_car.json'), '{}');
    write(path.join(carDir, 'data.acd'), 'old');

    const item = {
      id: 'car:plan_car', type: 'car', name: 'plan_car', sourceRoot: 'content/cars/plan_car',
      files: [
        { rel: 'ui/ui_car.json', size: 2 },
        { rel: 'data.acd', size: 3 },
        { rel: 'sfx/new.wav', size: 5 }
      ]
    };
    buildPlan(game, [item]);
    assert.strictEqual(item.status, 'update');
    assert.strictEqual(item.overwriteCount, 2);
    assert.strictEqual(item.addCount, 1);
    assert.strictEqual(targetRelative(item), 'content/cars/plan_car');
  }

  /* ===================================================================
     4) executeInstall (folder source) with backup + progress
     =================================================================== */
  {
    const src = path.join(tmp, 'exec_src');
    write(path.join(src, 'ui', 'ui_car.json'), '{"name":"Exec Car"}');
    write(path.join(src, 'data.acd'), 'new-data');

    const target = path.join(game, 'content', 'cars', 'exec_car');
    write(path.join(target, 'data.acd'), 'old-data');

    const progress = [];
    const item = {
      id: 'car:exec_car', type: 'car', name: 'exec_car', sourceRoot: '', targetDir: target,
      files: [{ rel: 'ui/ui_car.json', size: 1 }, { rel: 'data.acd', size: 8 }]
    };

    const res = await executeInstall(src, [item], {
      gamePath: game,
      backupsDir: backups,
      onProgress: (p) => progress.push(p),
      isCancelled: () => false
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.installedCount, 1);
    assert.strictEqual(fs.readFileSync(path.join(target, 'data.acd'), 'utf8'), 'new-data');
    assert.strictEqual(fs.readFileSync(path.join(target, 'ui', 'ui_car.json'), 'utf8'), '{"name":"Exec Car"}');
    const installed = res.items[0];
    const overwritten = installed.installedFiles.find((f) => f.rel === 'data.acd');
    assert.ok(overwritten && overwritten.existed && overwritten.backupPath, 'overwritten file should be backed up');
    assert.ok(fs.existsSync(overwritten.backupPath), 'backup file should exist');
    assert.ok(progress.some((p) => p.stage === 'start'));
    assert.ok(progress.some((p) => p.stage === 'installed'));
  }

  /* ===================================================================
     5) analyzeSource end-to-end (folder)
     =================================================================== */
  {
    const src = path.join(tmp, 'analyze_src');
    write(path.join(src, 'content', 'cars', 'analyze_car', 'ui', 'ui_car.json'), '{"name":"Analyze Car","brand":"AC"}');
    write(path.join(src, 'content', 'cars', 'analyze_car', 'ui', 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(path.join(src, 'content', 'cars', 'analyze_car', 'data.acd'), 'd');

    const analysis = await analyzeSource(src, game);
    assert.strictEqual(analysis.ok, true);
    assert.strictEqual(analysis.totalItems, 1);
    const it = analysis.items[0];
    assert.strictEqual(it.type, 'car');
    assert.strictEqual(it.displayName, 'Analyze Car');
    assert.strictEqual(it.brand, 'AC');
    assert.strictEqual(it.status, 'new');
    assert.ok(it.preview && it.preview.base64, 'preview should be extracted');
    assert.strictEqual(analysis.source.kind, 'folder');
  }

  /* ===================================================================
     6) 7z → graceful unsupported
     =================================================================== */
  {
    const seven = path.join(tmp, 'x.7z');
    write(seven, 'x');
    const analysis = await analyzeSource(seven, game);
    assert.strictEqual(analysis.ok, false);
    assert.strictEqual(analysis.error, 'UNSUPPORTED_FORMAT');
    assert.strictEqual(analysis.format, '7z');
  }
}

main().then(() => console.log('MOD INSTALLER TESTS PASSED')).catch((e) => { console.error('MOD INSTALLER TEST FAILED', e); process.exit(1); });
