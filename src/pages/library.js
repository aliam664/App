/* ================================================================= */
/*  UHM Content Library — rich UI                                    */
/*                                                                    */
/*  Features:                                                         */
/*   - stats strip (cars, tracks, mods, size, previews)              */
/*   - tabs: all / cars / tracks / trash                             */
/*   - live search, sort, view toggle (grid / list), filters         */
/*   - facet dropdowns (country, brand, origin)                      */
/*   - cards with lazy preview hydration                             */
/*   - detail drawer/modal with metadata, specs, layouts etc.        */
/*   - trash: restore / permanent delete / empty trash               */
/* ================================================================= */

(function () {
  'use strict';

  var state = {
    items: [],
    trash: [],
    tab: 'all',
    search: '',
    sortKey: 'name',
    sortDir: 'asc',
    view: 'grid',
    origin: 'all',
    country: 'all',
    brand: 'all',
    withPreview: false,
    modsOnly: false,
    scanning: false,
    busy: false,
    gamePath: null,
    selected: null,
    lastSummary: null
  };

  var D = null;

  function initData() {
    D = window.libraryData;
    if (!D) throw new Error('libraryData missing');
  }

  /* ------------------------------------------------------------------ */
  /*  i18n helpers                                                       */
  /* ------------------------------------------------------------------ */

  function lang() {
    return window.appState.lang;
  }

  function t(key) {
    return window.i18n.t(lang(), key);
  }

  function s(key) {
    return window.i18n.t(lang(), 'library.' + key);
  }

  /* ------------------------------------------------------------------ */
  /*  Render entry point                                                 */
  /* ------------------------------------------------------------------ */

  function render(container) {
    initData();
    state.scanning = false;
    state.busy = false;
    state.items = [];
    state.trash = [];
    state.selected = null;
    state.gamePath = window.appState.settings && window.appState.settings.gamePath;

    if (!state.gamePath) {
      renderNoPath(container);
      return;
    }

    container.innerHTML = layoutTemplate(state.gamePath);
    bindCommon(container);
    runScan(true);
  }

  function renderNoPath(container) {
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step1')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>
      <section class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="text-dim">${s('notSet')}</div>
        <button class="btn-primary" id="btn-select-path">${s('selectPath')}</button>
      </section>
    `;
    document.getElementById('btn-back').addEventListener('click', goBack.bind(null, 'showcase'));
    document.getElementById('btn-select-path').addEventListener('click', () => navigate('gamePath'));
  }

  function layoutTemplate(gamePath) {
    return `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
        <button class="btn-secondary" id="btn-refresh">${s('refresh')}</button>
      </div>

      <div class="library-stats" id="library-stats">
        ${statSkeleton()}
      </div>

      <div class="library-toolbar">
        <div class="library-tabs" id="library-tabs" role="tablist">
          ${tabButton('all', s('all'), 'active')}
          ${tabButton('cars', s('cars'), '')}
          ${tabButton('tracks', s('tracks'), '')}
          ${tabButton('trash', s('trash'), '')}
        </div>

        <div class="library-toolbar-controls">
          <input class="library-search" id="library-search" type="search"
                 placeholder="${s('search')}" value="" autocomplete="off" />
          <select class="library-select" id="library-sort" title="${s('sortBy')}">
            <option value="name">${s('sortName')}</option>
            <option value="size">${s('sortSize')}</option>
            <option value="date">${s('sortDate')}</option>
            <option value="type">${s('sortType')}</option>
            <option value="origin">${s('sortOrigin')}</option>
          </select>
          <div class="library-view-toggle" role="group" title="${s('viewGrid')}">
            <button class="lib-view-btn active" id="view-grid" title="${s('viewGrid')}">▦</button>
            <button class="lib-view-btn" id="view-list" title="${s('viewList')}">☰</button>
          </div>
        </div>
      </div>

      <div class="library-filters" id="library-filters">
        <button class="facet-chip active" data-origin="all">${s('allOrigins')}</button>
        <button class="facet-chip" data-origin="mod">${s('filterMods')}</button>
        <button class="facet-chip" data-origin="kunos">${s('filterKunos')}</button>
        <button class="facet-chip" data-origin="dlc">${s('filterDlc')}</button>
        <button class="facet-chip" data-preview="1">${s('filterPreview')}</button>
        <select class="library-select" id="filter-country" title="${s('country')}">
          <option value="all">${s('allCountries')}</option>
        </select>
        <select class="library-select" id="filter-brand" title="${s('brand')}">
          <option value="all">${s('allBrands')}</option>
        </select>
      </div>

      <div class="library-summary" id="library-summary"></div>
      <div class="library-grid" id="library-grid">${gridSkeleton()}</div>

      <div class="library-detail-backdrop" id="detail-backdrop"></div>
      <div class="library-detail" id="library-detail"></div>
    `;
  }

  function statSkeleton() {
    return `
      <div class="stat-card loading"><div class="loader"></div></div>
      <div class="stat-card loading"><div class="loader"></div></div>
      <div class="stat-card loading"><div class="loader"></div></div>
      <div class="stat-card loading"><div class="loader"></div></div>
      <div class="stat-card loading"><div class="loader"></div></div>
    `;
  }

  function gridSkeleton() {
    let cards = '';
    for (let i = 0; i < 8; i += 1) {
      cards += `
        <div class="content-card skeleton">
          <div class="content-card-preview skeleton-block"></div>
          <div class="content-card-body">
            <div class="skeleton-line" style="width:70%"></div>
            <div class="skeleton-line" style="width:45%"></div>
            <div class="skeleton-line" style="width:30%"></div>
          </div>
        </div>`;
    }
    return cards;
  }

  function tabButton(value, label, active) {
    return `<button class="library-tab ${active}" data-tab="${value}" role="tab">${label}</button>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Event wiring                                                       */
  /* ------------------------------------------------------------------ */

  function bindCommon(container) {
    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    document.getElementById('btn-refresh').addEventListener('click', () => runScan(true));

    container.querySelectorAll('.library-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        container.querySelectorAll('.library-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderGrid();
      });
    });

    document.getElementById('library-search').addEventListener('input', debounce((e) => {
      state.search = e.target.value;
      renderGrid();
    }, 160));

    document.getElementById('library-sort').addEventListener('change', (e) => {
      state.sortKey = e.target.value;
      renderGrid();
    });

    document.getElementById('view-grid').addEventListener('click', () => {
      state.view = 'grid';
      refreshViewToggle();
      renderGrid();
    });
    document.getElementById('view-list').addEventListener('click', () => {
      state.view = 'list';
      refreshViewToggle();
      renderGrid();
    });

    container.querySelectorAll('[data-origin]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.origin = chip.dataset.origin;
        container.querySelectorAll('[data-origin]').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        renderGrid();
      });
    });

    const prevChip = container.querySelector('[data-preview]');
    if (prevChip) {
      prevChip.addEventListener('click', () => {
        state.withPreview = !state.withPreview;
        prevChip.classList.toggle('active', state.withPreview);
        renderGrid();
      });
    }

    document.getElementById('filter-country').addEventListener('change', (e) => {
      state.country = e.target.value;
      renderGrid();
    });
    document.getElementById('filter-brand').addEventListener('change', (e) => {
      state.brand = e.target.value;
      renderGrid();
    });

    document.getElementById('detail-backdrop').addEventListener('click', closeDetail);
    document.addEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeDetail();
  }

  function refreshViewToggle() {
    const grid = document.getElementById('view-grid');
    const list = document.getElementById('view-list');
    if (grid && list) {
      grid.classList.toggle('active', state.view === 'grid');
      list.classList.toggle('active', state.view === 'list');
    }
    const gridEl = document.getElementById('library-grid');
    if (gridEl) gridEl.classList.toggle('library-list', state.view === 'list');
  }

  function debounce(fn, ms) {
    let id = null;
    return function inner() {
      const args = arguments;
      clearTimeout(id);
      id = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Scanning                                                           */
  /* ------------------------------------------------------------------ */

  async function runScan(fresh) {
    if (state.scanning) return;
    state.scanning = true;
    setScanningUI(true);
    try {
      if (fresh || state.items.length === 0) {
        const data = await window.uhm.scanLibrary(state.gamePath);
        state.items = (data && data.cars ? data.cars : []).concat(data && data.tracks ? data.tracks : []);
      }
      try { state.trash = await window.uhm.listTrash(); } catch (e) { state.trash = []; }
      renderStats();
      renderGrid();
      hydratePreviews();
    } catch (e) {
      state.items = [];
      renderStats();
      renderGrid();
      uhmToast(t('toast.error'), 'error');
    } finally {
      state.scanning = false;
      setScanningUI(false);
    }
  }

  function setScanningUI(on) {
    const refresh = document.getElementById('btn-refresh');
    if (refresh) refresh.disabled = on;
  }

  /* ------------------------------------------------------------------ */
  /*  Stats                                                              */
  /* ------------------------------------------------------------------ */

  function renderStats() {
    const wrap = document.getElementById('library-stats');
    if (!wrap) return;
    const agg = D.aggregate(state.items);
    const previews = agg.previews;
    const size = D.formatBytes(agg.totalSize) || s('unknown');
    wrap.innerHTML = `
      ${statCard('🚗', s('statsCars'), D.formatCount(agg.cars))}
      ${statCard('📍', s('statsTracks'), D.formatCount(agg.tracks))}
      ${statCard('🧩', s('statsMods'), D.formatCount(agg.mods))}
      ${statCard('📦', s('statsSize'), size)}
      ${statCard('🖼', 'Preview', D.formatCount(previews))}
    `;
  }

  function statCard(icon, label, value) {
    return `
      <div class="stat-card">
        <div class="stat-icon">${icon}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Grid / list rendering                                              */
  /* ------------------------------------------------------------------ */

  function activeItems() {
    if (state.tab === 'trash') return state.trash;
    const items = state.tab === 'cars' ? state.items.filter((i) => i.type === 'car')
      : state.tab === 'tracks' ? state.items.filter((i) => i.type === 'track')
      : state.items;
    return items;
  }

  function renderGrid() {
    const grid = document.getElementById('library-grid');
    const summary = document.getElementById('library-summary');
    if (!grid) return;

    refreshViewToggle();
    renderFacetOptions();

    if (state.tab === 'trash') {
      renderTrash(grid, summary);
      return;
    }

    const base = activeItems();
    const filtered = D.sortLibrary(
      D.filterLibrary(base, {
        search: state.search,
        type: state.tab,
        origin: state.origin,
        country: state.country,
        brand: state.brand,
        withPreview: state.withPreview,
        modsOnly: state.modsOnly
      }),
      state.sortKey,
      state.sortDir
    );

    if (base.length === 0) {
      grid.innerHTML = emptyState(s('emptyTitle'), s('emptyHint'), '📦');
      summary.innerHTML = '';
      return;
    }
    if (filtered.length === 0) {
      grid.innerHTML = emptyState(s('empty'), '', '🔍');
      summary.innerHTML = `<div class="library-summary-text">0 ${s('count')}</div>`;
      return;
    }

    const viewClass = state.view === 'list' ? ' library-list' : '';
    grid.className = 'library-grid' + viewClass;
    grid.innerHTML = state.view === 'list'
      ? filtered.map(listRow).join('')
      : filtered.map(cardTemplate).join('');

    grid.querySelectorAll('[data-op="open"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openDetail(el.dataset.id);
      });
    });

    grid.querySelectorAll('[data-op="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doDelete(btn.dataset.id);
      });
    });

    grid.querySelectorAll('[data-op="purge"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doPurge(btn.dataset.id);
      });
    });

    grid.querySelectorAll('[data-op="restore"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doRestore(btn.dataset.id);
      });
    });

    grid.querySelectorAll('[data-op="reveal"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doReveal(btn.dataset.id);
      });
    });

    summary.innerHTML = `
      <div class="library-summary-text">
        <strong>${D.formatCount(filtered.length)}</strong> ${s('count')}
        <span class="text-dim">· ${s('sortBy')}: ${s('sort' + capitalize(state.sortKey))}</span>
      </div>`;
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function renderFacetOptions() {
    const base = activeItems();
    const facets = D.collectFacets(base);

    const countrySel = document.getElementById('filter-country');
    if (countrySel) {
      const current = state.country;
      if (countrySel.options.length !== facets.countries.length + 1) {
        countrySel.innerHTML = `<option value="all">${s('allCountries')}</option>` +
          facets.countries.map((c) => `<option value="${uhmEsc(c)}">${uhmEsc(c)}</option>`).join('');
      }
      const next = facets.countries.includes(current) ? current : 'all';
      setSelectValue(countrySel, next);
      if (!facets.countries.includes(current)) state.country = 'all';
    }

    const brandSel = document.getElementById('filter-brand');
    if (brandSel) {
      const currentBrand = state.brand;
      if (brandSel.options.length !== facets.brands.length + 1) {
        brandSel.innerHTML = `<option value="all">${s('allBrands')}</option>` +
          facets.brands.map((c) => `<option value="${uhmEsc(c)}">${uhmEsc(c)}</option>`).join('');
      }
      const nextBrand = facets.brands.includes(currentBrand) ? currentBrand : 'all';
      setSelectValue(brandSel, nextBrand);
      if (!facets.brands.includes(currentBrand)) state.brand = 'all';
    }
  }

  function setSelectValue(select, value) {
    try {
      select.value = value;
    } catch (e) {
      for (let i = 0; i < (select.options || []).length; i += 1) {
        const opt = select.options[i];
        const match = opt && opt.value === value;
        if (match) {
          try { opt.selected = true; } catch (e2) { /* ignore */ }
        }
      }
    }
  }

  function emptyState(title, hint, icon) {
    return `
      <section class="empty-state">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">${uhmEsc(title)}</div>
        ${hint ? `<div class="text-dim">${uhmEsc(hint)}</div>` : ''}
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Templates                                                          */
  /* ------------------------------------------------------------------ */

  function cardTemplate(item) {
    const badge = originBadges(item);
    const meta = quickMeta(item);
    const previewClass = item.hasPreview ? '' : 'no-preview';
    const fallbackIcon = item.type === 'car' ? '🚗' : '📍';
    const size = item.sizeBytes != null ? D.formatBytes(item.sizeBytes) : '';
    const count = item.type === 'car' ? (item.skinCount || 0) : (item.layoutCount || 1);

    return `
      <article class="content-card" data-id="${item.id}">
        <div class="content-card-preview ${previewClass}" data-preview="${item.preview ? uhmEsc(item.preview) : ''}" data-id="${item.id}">
          ${item.hasPreview ? '' : `<span class="content-preview-fallback">${fallbackIcon}<br/><span class="text-dim">${s('noPreview')}</span></span>`}
        </div>
        <div class="content-card-body">
          <div class="content-card-head">
            <span class="content-card-type">${item.type === 'car' ? '🚗' : '📍'}</span>
            <div class="content-card-badges">${badge}</div>
          </div>
          <div class="content-card-title" title="${uhmEsc(item.name)}">${uhmEsc(item.name)}</div>
          <div class="content-card-meta text-dim">${meta}</div>
          <div class="content-card-foot">
            <span class="text-dim">${size ? size : ''}${size && count ? ' · ' : ''}${count ? D.formatCount(count) + ' ' + (item.type === 'car' ? s('skins') : s('layouts')) : ''}</span>
            <button class="btn-secondary content-delete" data-op="delete" data-id="${item.id}">${s('delete')}</button>
          </div>
        </div>
      </article>`;
  }

  function listRow(item) {
    const badge = originBadges(item);
    const fallbackIcon = item.type === 'car' ? '🚗' : '📍';
    const size = item.sizeBytes != null ? D.formatBytes(item.sizeBytes) : '';
    const count = item.type === 'car' ? (item.skinCount || 0) : (item.layoutCount || 1);

    return `
      <article class="content-row" data-id="${item.id}">
        <div class="content-row-preview ${item.hasPreview ? '' : 'no-preview'}" data-preview="${item.preview ? uhmEsc(item.preview) : ''}" data-id="${item.id}">
          ${item.hasPreview ? '' : `<span class="content-preview-fallback">${fallbackIcon}</span>`}
        </div>
        <div class="content-row-main" data-op="open" data-id="${item.id}">
          <div class="content-row-title">${uhmEsc(item.name)}</div>
          <div class="content-row-sub text-dim">${quickMeta(item)}${item.origin ? ' · ' + originLabel(item.origin) : ''}</div>
        </div>
        <div class="content-row-meta text-dim">
          <span>${size || '—'}</span>
          <span>${count ? D.formatCount(count) + ' ' + (item.type === 'car' ? s('skins') : s('layouts')) : ''}</span>
          ${badge}
        </div>
        <div class="content-row-actions">
          <button class="btn-secondary content-delete" data-op="delete" data-id="${item.id}">${s('delete')}</button>
        </div>
      </article>`;
  }

  function quickMeta(item) {
    if (item.type === 'car') {
      const parts = [];
      if (item.brand) parts.push(item.brand);
      if (item['class'] || item.klass) parts.push(item['class'] || item.klass);
      if (item.specs && item.specs.power) parts.push(`${D.formatNumber(item.specs.power)} hp`);
      return parts.map(uhmEsc).join(' · ');
    }
    const parts = [];
    if (item.country) parts.push(item.country);
    if (item.length) parts.push(item.length);
    if (item.city) parts.push(item.city);
    return parts.map(uhmEsc).join(' · ');
  }

  function originBadges(item) {
    let html = '';
    if (item.isKunos) html += `<span class="badge badge-kunos">${s('kunos')}</span>`;
    if (item.isDlc) html += `<span class="badge badge-dlc">${s('dlc')}</span>`;
    if (item.isMod) html += `<span class="badge badge-mod">${s('mod')}</span>`;
    if (!item.hasPreview) html += `<span class="badge badge-muted">${s('noPreview')}</span>`;
    return html;
  }

  function originLabel(origin) {
    if (origin === 'mod') return s('mod');
    if (origin === 'dlc') return s('dlc');
    if (origin === 'kunos') return s('kunos');
    return s('unknown');
  }

  /* ------------------------------------------------------------------ */
  /*  Trash                                                              */
  /* ------------------------------------------------------------------ */

  function renderTrash(grid, summary) {
    const items = state.trash;
    if (items.length === 0) {
      grid.innerHTML = emptyState(s('emptyTrash'), '', '🗑');
      summary.innerHTML = '';
      return;
    }
    grid.className = 'library-grid' + (state.view === 'list' ? ' library-list' : '');
    grid.innerHTML = state.view === 'list'
      ? items.map(trashRow).join('')
      : items.map(trashCard).join('');

    grid.querySelectorAll('[data-op="restore"]').forEach((btn) => {
      btn.addEventListener('click', () => doRestore(btn.dataset.id));
    });
    grid.querySelectorAll('[data-op="purge"]').forEach((btn) => {
      btn.addEventListener('click', () => doPurge(btn.dataset.id));
    });

    summary.innerHTML = `
      <div class="library-summary-text">
        <strong>${D.formatCount(items.length)}</strong> ${s('count')}
        <button class="btn-secondary btn-sm" id="btn-empty-trash" data-op="empty">${s('emptyTrash')}</button>
      </div>`;
    const emptyBtn = document.getElementById('btn-empty-trash');
    if (emptyBtn) emptyBtn.addEventListener('click', doEmptyTrash);
  }

  function trashCard(item) {
    return `
      <article class="content-card trash-card" data-id="${item.id}">
        <div class="content-card-preview no-preview">
          <span class="content-preview-fallback">🗑<br/><span class="text-dim">${item.type === 'car' ? '🚗' : '📍'} ${uhmEsc(item.folder)}</span></span>
        </div>
        <div class="content-card-body">
          <div class="content-card-head"><div class="content-card-badges">${originBadges(item)}</div></div>
          <div class="content-card-title">${uhmEsc(item.folder)}</div>
          <div class="content-card-meta text-dim">${window.uhmFormatDate(item.deletedAt)}</div>
          <div class="content-card-foot">
            <span class="text-dim">${item.existsOnDisk ? '' : s('missing')}</span>
            <button class="btn-secondary content-restore" data-op="restore" data-id="${item.id}">${s('restore')}</button>
            <button class="btn-secondary content-purge" data-op="purge" data-id="${item.id}">${s('purge')}</button>
          </div>
        </div>
      </article>`;
  }

  function trashRow(item) {
    return `
      <article class="content-row" data-id="${item.id}">
        <div class="content-row-preview no-preview"><span class="content-preview-fallback">🗑</span></div>
        <div class="content-row-main">
          <div class="content-row-title">${uhmEsc(item.folder)}</div>
          <div class="content-row-sub text-dim">${window.uhmFormatDate(item.deletedAt)} · ${item.type === 'car' ? s('cars') : s('tracks')}</div>
        </div>
        <div class="content-row-meta text-dim">${originBadges(item)}</div>
        <div class="content-row-actions">
          <button class="btn-secondary content-restore" data-op="restore" data-id="${item.id}">${s('restore')}</button>
          <button class="btn-secondary content-purge" data-op="purge" data-id="${item.id}">${s('purge')}</button>
        </div>
      </article>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Preview hydration (lazy)                                           */
  /* ------------------------------------------------------------------ */

  async function hydratePreviews() {
    const nodes = document.querySelectorAll('[data-preview]');
    for (const el of nodes) {
      const rel = el.getAttribute('data-preview');
      if (!rel) continue;
      el.removeAttribute('data-preview');
      try {
        const url = await window.uhm.getContentPreview({ gamePath: state.gamePath, relPath: rel });
        if (url && typeof url === 'string') {
          el.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
          el.classList.remove('no-preview');
        } else if (url && url.tooLarge) {
          el.insertAdjacentHTML('beforeend', `<span class="preview-too-large">${s('noPreview')}</span>`);
        }
      } catch (e) { /* fallback stays */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Detail drawer                                                      */
  /* ------------------------------------------------------------------ */

  function findItem(id) {
    return state.items.find((i) => i.id === id) || state.trash.find((i) => i.id === id) || null;
  }

  function openDetail(id) {
    const item = findItem(id);
    if (!item) return;
    state.selected = item;
    const drawer = document.getElementById('library-detail');
    const backdrop = document.getElementById('detail-backdrop');
    if (!drawer) return;
    drawer.innerHTML = detailTemplate(item);
    backdrop.classList.add('open');
    drawer.classList.add('open');
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.getElementById('detail-delete').addEventListener('click', () => doDelete(item.id));
    hydrateSinglePreview(drawer.querySelector('.detail-preview'), item.preview);
  }

  async function hydrateSinglePreview(el, rel) {
    if (!el || !rel) return;
    try {
      const url = await window.uhm.getContentPreview({ gamePath: state.gamePath, relPath: rel });
      if (url && typeof url === 'string') {
        el.innerHTML = `<img src="${url}" alt="" />`;
        el.classList.remove('no-preview');
      }
    } catch (e) { /* keep fallback */ }
  }

  function closeDetail() {
    const drawer = document.getElementById('library-detail');
    const backdrop = document.getElementById('detail-backdrop');
    if (drawer) { drawer.classList.remove('open'); drawer.innerHTML = ''; }
    if (backdrop) backdrop.classList.remove('open');
    state.selected = null;
  }

  function detailTemplate(item) {
    const isCar = item.type === 'car';
    const preview = item.hasPreview
      ? `<div class="detail-preview" data-preview=""></div>`
      : `<div class="detail-preview no-preview"><span class="content-preview-fallback">${isCar ? '🚗' : '📍'}<br/><span class="text-dim">${s('noPreview')}</span></span></div>`;
    const specRows = isCar ? `
      ${detailKey(s('brand'), item.brand)}
      ${detailKey(s('class'), item['class'] || item.klass)}
      ${detailKey(s('year'), item.year)}
      ${detailKey(s('power'), item.specs && item.specs.power ? item.specs.power + ' hp' : '')}
      ${detailKey(s('torque'), item.specs && item.specs.torque ? item.specs.torque + ' Nm' : '')}
      ${detailKey(s('weight'), item.specs && item.specs.weight ? item.specs.weight + ' kg' : '')}
      ${detailKey(s('topSpeed'), item.specs && item.specs.topSpeed ? item.specs.topSpeed : '')}
      ${detailKey(s('skins'), item.skinCount ? D.formatCount(item.skinCount) : '')}
    ` : `
      ${detailKey(s('country'), item.country)}
      ${detailKey(s('city'), item.city)}
      ${detailKey(s('location'), item.location)}
      ${detailKey(s('trackLength'), item.length)}
      ${detailKey(s('trackWidth'), item.width)}
      ${detailKey(s('layouts'), item.layoutCount ? D.formatCount(item.layoutCount) : '')}
    `;

    const featureChips = `
      ${item.folder ? `<span class="feature-chip">${s('folder')}: ${uhmEsc(item.folder)}</span>` : ''}
      ${item.hasUi != null ? `<span class="feature-chip">${item.hasUi ? s('hasUi') : s('noUi')}</span>` : ''}
      ${isCar && item.hasData ? `<span class="feature-chip">${s('dataOk')}</span>` : ''}
      ${isCar && item.hasSound ? `<span class="feature-chip">${s('soundOk')}</span>` : ''}
      ${isCar && item.hasCamera ? `<span class="feature-chip">${s('cameraOk')}</span>` : ''}
    `;

    const layoutList = (item.layouts && item.layouts.length)
      ? `<div class="detail-layouts">${item.layouts.map((l) => `
          <div class="layout-row">
            <span>${uhmEsc(l.name)}</span>
            <span class="text-dim">${l.length ? l.length : ''}${l.country ? ' · ' + uhmEsc(l.country) : ''}</span>
          </div>`).join('')}</div>`
      : `<div class="text-dim">${isCar ? '' : s('noLayouts')}</div>`;

    return `
      <div class="detail-body">
        <button class="detail-close" id="detail-close">✕</button>
        ${preview}
        <div class="detail-content">
          <div class="detail-title">${uhmEsc(item.name)}</div>
          <div class="detail-badges">${originBadges(item)}</div>
          ${item.description ? `<p class="detail-desc">${uhmEsc(item.description)}</p>` : ''}
          <div class="detail-grid">${specRows}</div>
          <div class="detail-section-title">${s('source')}</div>
          <div class="feature-chips">${featureChips}</div>
          ${isCar && item.skins && item.skins.length ? `<div class="detail-section-title">${s('skins')}</div><div class="detail-skins">${item.skins.slice(0, 20).map((sk) => `<span class="skin-chip">${uhmEsc(sk)}</span>`).join('')}</div>` : ''}
          ${!isCar ? `<div class="detail-section-title">${s('layouts')}</div>${layoutList}` : ''}
          <div class="detail-meta text-dim">
            <span>${s('size')}: ${item.sizeBytes != null ? D.formatBytes(item.sizeBytes) : '—'}</span>
            <span>${s('files')}: ${D.formatCount(item.fileCount || 0)}</span>
            <span>${s('modified')}: ${item.modifiedAt ? window.uhmFormatDate(item.modifiedAt) : '—'}</span>
          </div>
        </div>
      </div>`;
  }

  function detailKey(label, value) {
    if (!value) return '';
    return `
      <div class="detail-key">
        <span class="detail-key-label">${uhmEsc(label)}</span>
        <span class="detail-key-value">${uhmEsc(value)}</span>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  async function doDelete(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const item = findItem(id);
      const confirmed = await window.uhmConfirm({
        title: s('deleteConfirm'),
        body: `<div class="text-dim">${uhmEsc(item ? item.name || item.folder : id)}</div>`,
        ok: s('delete'),
        cancel: t('common.cancel'),
        danger: true
      });
      if (!confirmed) return;

      const type = item && item.type ? item.type : id.split(':')[0];
      const folder = item ? item.folder : id.split(':')[1];
      const result = await window.uhm.deleteContent({ gamePath: state.gamePath, type, folder });
      if (result && result.success) {
        state.items = state.items.filter((i) => i.id !== id);
        state.trash = await window.uhm.listTrash();
        closeDetail();
        renderStats();
        renderGrid();
        hydratePreviews();
        uhmToast(s('deleteDone'), 'success');
      } else {
        uhmToast(result && result.error === 'NOT_FOUND' ? t('common.pageMissing') : t('toast.error'), 'error');
      }
    } finally {
      state.busy = false;
    }
  }

  async function doRestore(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const confirmed = await window.uhmConfirm({
        title: s('restoreConfirm'),
        ok: s('restore'),
        cancel: t('common.cancel')
      });
      if (!confirmed) return;
      const result = await window.uhm.restoreContent({ trashId: id });
      if (result && result.success) {
        state.trash = await window.uhm.listTrash();
        renderGrid();
        if (result.conflictPath) uhmToast(s('restoreDone') + ' · ' + result.conflictPath, 'success', 4200);
        else uhmToast(s('restoreDone'), 'success');
      } else uhmToast(t('toast.error'), 'error');
    } finally {
      state.busy = false;
    }
  }

  async function doPurge(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      const item = findItem(id);
      const confirmed = await window.uhmConfirm({
        title: s('purgeConfirm'),
        body: `<div class="text-dim">${uhmEsc(item ? item.folder || item.name : id)}</div>`,
        ok: s('purge'),
        cancel: t('common.cancel'),
        danger: true
      });
      if (!confirmed) return;
      const result = await window.uhm.purgeContent({ trashId: id });
      if (result && result.success) {
        state.trash = await window.uhm.listTrash();
        renderGrid();
        uhmToast(s('purgeDone'), 'success');
      } else uhmToast(t('toast.error'), 'error');
    } finally {
      state.busy = false;
    }
  }

  async function doEmptyTrash() {
    if (state.busy) return;
    state.busy = true;
    try {
      const confirmed = await window.uhmConfirm({
        title: s('emptyTrashConfirm'),
        ok: s('purge'),
        cancel: t('common.cancel'),
        danger: true
      });
      if (!confirmed) return;
      const result = await window.uhm.emptyTrash();
      if (result && result.success) {
        state.trash = [];
        renderGrid();
        uhmToast(s('emptyTrashDone'), 'success');
      } else uhmToast(t('toast.error'), 'error');
    } finally {
      state.busy = false;
    }
  }

  async function doReveal(id) {
    const item = findItem(id);
    if (!item) return;
    // In the future this can call shell.showItemInFolder via IPC.
    uhmToast(s('revealed'), 'info');
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  function destroy() {
    document.removeEventListener('keydown', onKeyDown);
    closeDetail();
  }

  window.pages.library = { render, destroy };
})();
