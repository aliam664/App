/* ================================================================= */
/*  UHM Content Library — renderer-side pure helpers                 */
/*                                                                    */
/*  These functions are intentionally free of DOM access so they can  */
/*  be unit-tested in Node and reused by the library page.           */
/* ================================================================= */

(function (root) {
  'use strict';

  function identity(v) {
    return v == null ? '' : String(v);
  }

  /* ---------- Search ---------- */
  function matchesSearch(item, term) {
    if (!term) return true;
    const q = identity(term).trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      item.name,
      item.folder,
      item.brand,
      item['class'],
      item.klass,
      item.country,
      item.city,
      item.location,
      item.year,
      item.origin,
      item.length,
      item.description,
      ...(item.layouts || []).map((l) => l.name)
    ].filter(Boolean).join(' ').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
  }

  /* ---------- Filters ---------- */
  function filterLibrary(items, options) {
    const type = (options && options.type) || 'all';
    const origin = (options && options.origin) || 'all';
    const country = (options && options.country) || 'all';
    const brand = (options && options.brand) || 'all';
    const onlyPreview = Boolean(options && options.withPreview);
    const modsOnly = Boolean(options && options.modsOnly);

    return (items || []).filter((item) => {
      if (type !== 'all' && item.type !== type) return false;
      if (origin === 'mod' && !item.isMod) return false;
      if (origin === 'kunos' && !item.isKunos) return false;
      if (origin === 'dlc' && !item.isDlc) return false;
      if (onlyPreview && !item.hasPreview) return false;
      if (modsOnly && !item.isMod) return false;
      if (country !== 'all' && item.country !== country) return false;
      if (brand !== 'all' && item.brand !== brand) return false;
      return matchesSearch(item, options && options.search);
    });
  }

  /* ---------- Sorting ---------- */
  function sortLibrary(items, key, dir) {
    const order = dir === 'desc' ? -1 : 1;
    const fn =
      key === 'size' ? (a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0)
      : key === 'date' ? (a, b) => identity(a.modifiedAt).localeCompare(identity(b.modifiedAt))
      : key === 'type' ? (a, b) => a.type.localeCompare(b.type)
      : key === 'origin' ? (a, b) => identity(a.origin).localeCompare(identity(b.origin))
      : key === 'brand' ? (a, b) => identity(a.brand).localeCompare(identity(b.brand))
      : (a, b) => identity(a.name).localeCompare(identity(b.name));
    return [...items].sort((a, b) => fn(a, b) * order);
  }

  /* ---------- Aggregation ---------- */
  function collectFacets(items) {
    const countries = new Set();
    const brands = new Set();
    const origins = new Set();
    for (const item of items || []) {
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

  function aggregate(items) {
    const all = items || [];
    const cars = all.filter((i) => i.type === 'car');
    const tracks = all.filter((i) => i.type === 'track');
    const mods = all.filter((i) => i.isMod);
    const totalSize = all.reduce((sum, i) => sum + (i.sizeBytes || 0), 0);
    const previews = all.filter((i) => i.hasPreview).length;
    return { total: all.length, cars: cars.length, tracks: tracks.length, mods: mods.length, totalSize, previews };
  }

  /* ---------- Formatting ---------- */
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = Math.abs(bytes);
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatCount(n) {
    return new Intl.NumberFormat('en-US').format(n || 0);
  }

  function formatNumber(n) {
    if (n == null || n === '') return '';
    const num = Number.parseFloat(n);
    if (Number.isNaN(num)) return identity(n);
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(num);
  }

  function sortLabels(key) {
    return {
      name: 'name', size: 'size', date: 'date', type: 'type', origin: 'origin', brand: 'brand'
    }[key] || 'name';
  }

  var api = {
    matchesSearch,
    filterLibrary,
    sortLibrary,
    collectFacets,
    aggregate,
    formatBytes,
    formatCount,
    formatNumber,
    sortLabels
  };

  root.libraryData = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
