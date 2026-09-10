/* ------------------------------------------------------------------ */
/*  i18n coverage tests                                                */
/*                                                                    */
/*  Guarantees that every language (fa/en/zh/ja) exposes the exact    */
/*  same key set — no missing keys, no orphans — and that every leaf  */
/*  resolves to a non-empty string. This is what keeps a new language */
/*  complete instead of silently falling back to Persian.             */
/* ------------------------------------------------------------------ */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Load i18n.js in a minimal sandbox (it only needs a `window` global).
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'i18n.js'), 'utf8');
const sandbox = { window: {} };
const fn = new Function('window', code);
fn.call(sandbox, sandbox.window);

const { translations, t } = sandbox.window.i18n;

function leaves(obj, prefix, out) {
  for (const key of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (obj[key] && typeof obj[key] === 'object') leaves(obj[key], p, out);
    else out.push(p);
  }
}

const LANGS = ['fa', 'en', 'zh', 'ja'];
const keySets = {};
for (const l of LANGS) {
  const arr = [];
  leaves(translations[l], '', arr);
  keySets[l] = new Set(arr);
}

// 1) Every language must have the exact same key set.
const reference = keySets.en;
for (const l of LANGS) {
  const missing = [...reference].filter((k) => !keySets[l].has(k));
  const extra = [...keySets[l]].filter((k) => !reference.has(k));
  assert.strictEqual(missing.length, 0, `${l} is missing keys: ${missing.join(', ')}`);
  assert.strictEqual(extra.length, 0, `${l} has unknown keys: ${extra.join(', ')}`);
}

// 2) Every leaf must resolve to a non-empty string.
for (const l of LANGS) {
  for (const k of reference) {
    const val = t(l, k);
    assert.strictEqual(typeof val, 'string', `${l}.${k} must be a string`);
    assert.ok(val.length > 0, `${l}.${k} must not be empty`);
  }
}

// 3) Direction + representative translations per language.
assert.strictEqual(t('fa', 'dir'), 'rtl');
assert.strictEqual(t('en', 'dir'), 'ltr');
assert.strictEqual(t('zh', 'dir'), 'ltr');
assert.strictEqual(t('ja', 'dir'), 'ltr');
assert.strictEqual(t('zh', 'settings.title'), '设置');
assert.strictEqual(t('ja', 'settings.title'), '設定');
assert.strictEqual(t('zh', 'library.title'), '内容库');
assert.strictEqual(t('ja', 'library.title'), 'コンテンツライブラリ');
assert.strictEqual(t('zh', 'donate.copyCard'), '复制卡号');
assert.strictEqual(t('ja', 'donate.copyCard'), 'カード番号をコピー');

// 4) Unknown languages fall back to Persian (existing behavior).
assert.strictEqual(t('xx', 'settings.title'), translations.fa.settings.title);

console.log('I18N TESTS PASSED');
