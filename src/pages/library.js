(function () {
  let items = [];
  let trashItems = [];
  let activeTab = 'all';
  let searchTerm = '';
  let loading = false;
  let busy = false;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const gamePath = window.appState.settings && window.appState.settings.gamePath;

    if (!gamePath) {
      container.innerHTML = `
        <div class="page-header">
          <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
          <div class="page-header-copy">
            <div class="gamepath-step">${t('common.step1')}</div>
            <h2>${s('title')}</h2>
          </div>
        </div>
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <div class="text-dim">${s('notSet')}</div>
          <button class="btn-primary" id="btn-select-path">${s('selectPath')}</button>
        </div>
      `;
      document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
      document.getElementById('btn-select-path').addEventListener('click', () => navigate('gamePath'));
      return;
    }

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
        <button class="btn-secondary" id="btn-refresh">${s('refresh')}</button>
      </div>

      <div class="library-toolbar">
        <div class="library-tabs">
          <button class="library-tab active" data-tab="all">${s('all')}</button>
          <button class="library-tab" data-tab="cars">${s('cars')}</button>
          <button class="library-tab" data-tab="tracks">${s('tracks')}</button>
          <button class="library-tab" data-tab="trash">${s('trash')}</button>
        </div>
        <input class="library-search" id="library-search" type="search" placeholder="${s('search')}" />
      </div>

      <div class="library-grid" id="library-grid">
        <div class="loader"></div>
        <div class="text-dim" style="text-align:center;">${s('loading')}</div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    document.getElementById('btn-refresh').addEventListener('click', () => runScan(gamePath));

    container.querySelectorAll('.library-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('.library-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderGrid();
      });
    });

    document.getElementById('library-search').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderGrid();
    });

    runScan(gamePath);
  }

  async function runScan(gamePath) {
    loading = true;
    loadTrash();
    try {
      const data = await window.uhm.scanLibrary(gamePath);
      items = data.cars.concat(data.tracks);
    } catch (e) {
      items = [];
    }
    loading = false;
    renderGrid();
    hydratePreviews(gamePath);
  }

  async function loadTrash() {
    try {
      trashItems = await window.uhm.listTrash();
    } catch (e) {
      trashItems = [];
    }
  }

  function filteredItems() {
    if (activeTab === 'trash') return trashItems;
    if (activeTab === 'cars') return items.filter((i) => i.type === 'car');
    if (activeTab === 'tracks') return items.filter((i) => i.type === 'track');
    return items;
  }

  function renderGrid() {
    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const grid = document.getElementById('library-grid');
    if (!grid) return;

    if (activeTab === 'trash') {
      const list = trashItems;
      grid.innerHTML = list.length === 0
        ? `<div class="empty-state"><div class="empty-icon">🗑</div><div class="text-dim">${s('emptyTrash')}</div></div>`
        : list.map((item) => trashCard(item, lang)).join('');
      grid.querySelectorAll('[data-restore]').forEach((btn) => {
        btn.addEventListener('click', () => doRestore(btn.dataset.restore));
      });
      return;
    }

    const term = searchTerm.trim().toLowerCase();
    const list = filteredItems().filter((i) => {
      if (!term) return true;
      return (i.name || '').toLowerCase().includes(term) ||
             (i.brand || i.location || i.country || '').toLowerCase().includes(term);
    });

    if (list.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><div class="text-dim">${s('empty')}</div></div>`;
      return;
    }

    grid.innerHTML = list.map((item) => contentCard(item, lang)).join('');
    grid.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => doDelete(btn.dataset.delete));
    });

    // آمار بالای صفحه
    const countEl = document.querySelector('.library-tabs');
    if (countEl) {
      const total = items.length;
      countEl.setAttribute('data-count', total);
    }
  }

  function contentCard(item, lang) {
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const meta = item.type === 'car'
      ? [item.brand && s('brand') + ': ' + item.brand, item['class'] && s('class') + ': ' + item['class']]
      : [item.country && s('country') + ': ' + item.country, item.length && s('length') + ': ' + item.length + 'm'];
    const badge = item.isKunos
      ? `<span class="badge badge-kunos">${s('kunos')}</span>`
      : `<span class="badge badge-mod">${s('mod')}</span>`;
    const label = item.type === 'car' ? '🚗' : '📍';

    return `
      <div class="content-card" data-type="${item.type}" data-id="${uhmEsc(item.id)}">
        <div class="content-card-preview ${item.hasPreview ? '' : 'no-preview'}" data-preview="${item.preview ? uhmEsc(item.preview) : ''}">
          <span class="content-preview-fallback">${label}<br/><span class="text-dim">${s('noPreview')}</span></span>
        </div>
        <div class="content-card-body">
          <div class="content-card-title">${uhmEsc(item.name)}</div>
          <div class="content-card-meta text-dim">${meta.filter(Boolean).map(uhmEsc).join(' · ')}</div>
          <div class="content-card-badges">${badge}</div>
        </div>
        <button class="btn-secondary content-delete" data-delete="${item.type}:${uhmEsc(item.id)}">${s('delete')}</button>
      </div>
    `;
  }

  function trashCard(item, lang) {
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const label = item.type === 'car' ? '🚗' : '📍';
    return `
      <div class="content-card trash-card" data-id="${uhmEsc(item.id)}">
        <div class="content-card-preview no-preview">
          <span class="content-preview-fallback">🗑<br/><span class="text-dim">${label} ${uhmEsc(item.folder)}</span></span>
        </div>
        <div class="content-card-body">
          <div class="content-card-title">${uhmEsc(item.folder)}</div>
          <div class="content-card-meta text-dim">${window.uhmFormatDate(item.deletedAt)}</div>
        </div>
        <button class="btn-secondary content-restore" data-restore="${uhmEsc(item.id)}">${s('restore')}</button>
      </div>
    `;
  }

  async function hydratePreviews(gamePath) {
    const cards = document.querySelectorAll('[data-preview]');
    for (const card of cards) {
      const rel = card.dataset.preview;
      if (!rel) { card.dataset.loaded = '1'; continue; }
      try {
        const url = await window.uhm.getContentPreview({ gamePath, relPath: rel });
        if (url) {
          card.innerHTML = `<img src="${url}" alt="" />`;
          card.dataset.loaded = '1';
        }
      } catch (e) { /* keep fallback */ }
    }
  }

  async function doDelete(key) {
    if (busy) return;
    busy = true;
    const [type, ...idParts] = key.split(':');
    const id = idParts.join(':');
    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const t = (k) => window.i18n.t(lang, k);

    const item = items.find((i) => i.type === type && i.id === id);
    const confirmed = await window.uhmConfirm({
      title: s('deleteConfirm'),
      body: `<div class="text-dim">${uhmEsc(item ? item.name : id)}</div>`,
      ok: s('delete'),
      cancel: t('common.cancel'),
      danger: true
    });
    if (!confirmed) { busy = false; return; }

    const gamePath = window.appState.settings.gamePath;
    const result = await window.uhm.deleteContent({ gamePath, type, folder: id });
    if (result && result.success) {
      items = items.filter((i) => !(i.type === type && i.id === id));
      loadTrash().then(() => renderGrid());
      uhmToast(s('deleteDone'), 'success');
    } else {
      uhmToast(t('toast.error'), 'error');
    }
    busy = false;
  }

  async function doRestore(trashId) {
    if (busy) return;
    busy = true;
    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'library.' + k);
    const confirmed = await window.uhmConfirm({
      title: s('restoreConfirm'),
      ok: s('restore'),
      cancel: window.i18n.t(lang, 'common.cancel')
    });
    if (!confirmed) { busy = false; return; }

    const result = await window.uhm.restoreContent({ trashId });
    if (result && result.success) {
      loadTrash().then(() => renderGrid());
      uhmToast(s('restoreDone'), 'success');
    } else {
      uhmToast(window.i18n.t(lang, 'toast.error'), 'error');
    }
    busy = false;
  }

  window.pages.library = { render };
})();
