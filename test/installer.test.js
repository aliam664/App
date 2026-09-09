const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isWithin,
  resolveInside,
  copyDirectoryContents,
  extractArchive,
  installMods,
  uninstallFiles
} = require('../src/lib/installer');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uhm-test-'));
const game = path.join(tmp, 'game');
const assets = path.join(tmp, 'assets');
const backups = path.join(tmp, 'backups');
fs.mkdirSync(game, { recursive: true });
fs.mkdirSync(path.join(assets, 'csp', 'extension', 'config'), { recursive: true });
fs.mkdirSync(path.join(game, 'content'), { recursive: true });
fs.writeFileSync(path.join(assets, 'csp', 'extension', 'config', 'data_manifest.ini'), 'hi');
fs.writeFileSync(path.join(assets, 'csp', 'extension', 'config', 'pure.ini'), 'x');
fs.writeFileSync(path.join(game, 'acs.exe'), '');

(async () => {
  // 1. isWithin / resolveInside
  assert.ok(isWithin(game, path.join(game, 'x')));
  assert.ok(!isWithin(game, path.join(tmp, 'outside')));
  assert.strictEqual(resolveInside(game, 'extension/x'), path.join(game, 'extension', 'x'));
  assert.strictEqual(resolveInside(game, '../x'), null);

  // 2. installMods copies files
  const progress = [];
  const result = await installMods({
    gamePath: game,
    assetsModDir: assets,
    backupsDir: backups,
    tier: 'ultra',
    mods: [{ id: 'csp', dest: '', type: 'copy' }],
    onProgress: (d) => progress.push(d)
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mods[0].status, 'installed');
  assert.ok(fs.existsSync(path.join(game, 'extension', 'config', 'data_manifest.ini')));
  assert.ok(progress.length >= 2);

  // 3. backup is created on reinstall
  const result2 = await installMods({
    gamePath: game,
    assetsModDir: assets,
    backupsDir: backups,
    mods: [{ id: 'csp', dest: '', type: 'copy' }]
  });
  assert.strictEqual(result2.success, true);
  const bak = path.join(backups, 'csp', 'backup', 'extension', 'config', 'data_manifest.ini.bak');
  assert.ok(fs.existsSync(bak));

  // 4. uninstall restores
  const files = result2.mods[0].installedFiles;
  const un = await uninstallFiles(files.map((f) => ({ dest: f.dest, backupPath: f.backupPath })));
  assert.ok(un.every((u) => u.status === 'restored'));
  assert.ok(fs.existsSync(path.join(game, 'extension', 'config', 'data_manifest.ini')));

  // 5. missing source -> missing
  const r3 = await installMods({
    gamePath: game,
    assetsModDir: assets,
    backupsDir: backups,
    mods: [{ id: 'nope', dest: '' }]
  });
  assert.strictEqual(r3.mods[0].status, 'missing');

  // 6. zip extraction
  const zipPath = path.join(tmp, 'mod.zip');
  const admzip = new (require('adm-zip'))();
  admzip.addFile('extension/config/data_manifest.ini', Buffer.from('zipdata'));
  admzip.addFile('extension/pure.ini', Buffer.from('z'));
  admzip.writeZip(zipPath);
  const r4 = await installMods({
    gamePath: game,
    assetsModDir: path.dirname(zipPath),
    backupsDir: backups,
    mods: [{ id: 'zipmod', source: zipPath, dest: '', type: 'extract' }]
  });
  assert.strictEqual(r4.mods[0].status, 'installed');
  assert.ok(fs.existsSync(path.join(game, 'extension', 'config', 'data_manifest.ini')));
  assert.strictEqual(fs.readFileSync(path.join(game, 'extension', 'config', 'data_manifest.ini'), 'utf8'), 'zipdata');

  console.log('ALL TESTS PASSED');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
