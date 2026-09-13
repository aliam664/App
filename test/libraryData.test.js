/* ------------------------------------------------------------------ */
/*  Renderer-side library data helpers tests                           */
/* ------------------------------------------------------------------ */
const assert = require('assert');
const data = require('../src/js/libraryData');

const ITEMS = [
  {
    type: 'car', id: 'car:ks_ferrari_fxxk', folder: 'ks_ferrari_fxxk',
    name: 'Ferrari FXX K', brand: 'Ferrari', 'class': 'Race', origin: 'kunos',
    isKunos: true, isMod: false, isDlc: false,
    country: 'Italy', year: '2014', sizeBytes: 5000, modifiedAt: '2024-01-01', hasPreview: true
  },
  {
    type: 'car', id: 'car:bmw_m3', folder: 'bmw_m3',
    name: 'BMW M3 E30', brand: 'BMW', 'class': 'Road', origin: 'mod',
    isKunos: false, isMod: true, isDlc: false,
    country: 'Germany', year: '1986', sizeBytes: 2000, modifiedAt: '2023-01-01', hasPreview: false,
    layouts: []
  },
  {
    type: 'track', id: 'track:ks_monza', folder: 'ks_monza',
    name: 'Monza', brand: '', origin: 'kunos', isKunos: true, isMod: false, isDlc: false,
    country: 'Italy', city: 'Monza', length: '5.79 km', sizeBytes: 8000, modifiedAt: '2022-01-01', hasPreview: true,
    layouts: [{ name: 'Grand Prix' }, { name: 'Junior' }]
  },
  {
    type: 'track', id: 'track:drift', folder: 'drift_city',
    name: 'Drift City', brand: '', origin: 'mod', isKunos: false, isMod: true, isDlc: false,
    country: 'Japan', length: '2.1 km', sizeBytes: 1000, modifiedAt: '2025-01-01', hasPreview: false,
    layouts: [{ name: 'Main' }]
  }
];

// search
assert.strictEqual(data.matchesSearch(ITEMS[0], 'ferrari'), true);
assert.strictEqual(data.matchesSearch(ITEMS[0], 'fxx'), true);
assert.strictEqual(data.matchesSearch(ITEMS[0], 'monza'), false);
assert.strictEqual(data.matchesSearch(ITEMS[0], 'italy ferrari'), true);

// filter by type/origin/country/brand/withPreview/modsOnly
assert.strictEqual(data.filterLibrary(ITEMS, { type: 'car' }).length, 2);
assert.strictEqual(data.filterLibrary(ITEMS, { origin: 'mod' }).length, 2);
assert.strictEqual(data.filterLibrary(ITEMS, { origin: 'kunos' }).length, 2);
assert.strictEqual(data.filterLibrary(ITEMS, { country: 'Italy' }).length, 2);
assert.strictEqual(data.filterLibrary(ITEMS, { brand: 'Ferrari' }).length, 1);
assert.strictEqual(data.filterLibrary(ITEMS, { withPreview: true }).length, 2);
assert.strictEqual(data.filterLibrary(ITEMS, { modsOnly: true }).length, 2);

// sort
assert.strictEqual(data.sortLibrary(ITEMS, 'size', 'asc')[0].name, 'Drift City');
assert.strictEqual(data.sortLibrary(ITEMS, 'size', 'desc')[0].name, 'Monza');
assert.strictEqual(data.sortLibrary(ITEMS, 'date', 'desc')[0].name, 'Drift City');
assert.strictEqual(data.sortLibrary(ITEMS, 'name', 'asc')[0].name, 'BMW M3 E30');
assert.strictEqual(data.sortLibrary(ITEMS, 'type', 'asc')[0].type, 'car');

// facets
const facets = data.collectFacets(ITEMS);
assert.deepStrictEqual(facets.countries, ['Germany', 'Italy', 'Japan']);
assert.ok(facets.brands.includes('BMW'));
assert.ok(facets.origins.includes('mod'));

// aggregate
const agg = data.aggregate(ITEMS);
assert.strictEqual(agg.total, 4);
assert.strictEqual(agg.cars, 2);
assert.strictEqual(agg.tracks, 2);
assert.strictEqual(agg.mods, 2);
assert.strictEqual(agg.previews, 2);
assert.strictEqual(agg.totalSize, 16000);

// formatting
assert.strictEqual(data.formatBytes(0), '0 B');
assert.strictEqual(data.formatBytes(1024), '1.0 KB');
assert.strictEqual(data.formatBytes(5 * 1024 * 1024), '5.0 MB');
assert.strictEqual(data.formatCount(1234), '1,234');
assert.strictEqual(data.formatNumber('860'), '860');
assert.strictEqual(data.sortLabels('name'), 'name');

console.log('LIBRARY DATA TESTS PASSED');
