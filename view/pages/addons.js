/* ================================================================= */
/*  Add-ons — optional extras bundled in mods/addons/<id>/            */
/*                                                                    */
/*  Each add-on is a folder with an optional mod.json, a preview.png  */
/*  and a files/ mirror of the game folder. This page lists them as   */
/*  image cards and installs / removes them individually, reusing the */
/*  same installer + manifest as the graphics pack.                   */
/* ================================================================= */

(function () {
  let addons = [];
  let loading = false;
  let busyId = null;
  let unsubscribe = null;
  let active = false;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'addons.' + key); }
  function fmtBytes(n) { return window.libraryData ? window.libraryData.formatBytes(n) : String(n || 0); }

  function loc(v) {
    const lang = window.appState.lang;
    if (!v) return '';
    if (typeof v === 'string') return v;
    return v[lang] || v.en || v.fa || '';
  }

  function installedEntry(id) {
    const mods = (window.appState.manifest && window.appState.manifest.mods) || {};
    const entries = Array.isArray(mods[id]) ? mods[id] : [];
    const latest = entries[0];
    return latest && latest.status === 'installed' && (latest.files || []).length ? latest : null;
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                            */
  /* ------------------------------------------------------------------ */

  function render(container) {
    active = true;
    busyId = null;
    const lang = window.appState.lang;
    const gamePath = window.appState.settings && window.appState.settings.gamePath;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="page-stack addons-wrap">
        ${!gamePath ? `
          <div class="card-sec addons-nopath">
            <div>
              <div class="card-sec-title">${s('noPathTitle')}</div>
              <div class="card-sec-sub">${s('noPathSub')}</div>
            </div>
            <button class="btn-secondary" id="btn-set-path">${t('showcase.nextAction')}</button>
          </div>` : ''}
        <section class="ui-section">
          ${window.ui.sectionHeader({ icon: '', kicker: t('kicker.addons'), title: s('listTitle'), subtitle: s('listSub') })}
          <div class="addons-grid" id="addons-grid">
            <div class="addons-loading text-dim">${s('loading')}</div>
          </div>
        </section>
        <div class="text-dim install-note">${s('note')}</div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    const setPath = document.getElementById('btn-set-path');
    if (setPath) setPath.addEventListener('click', () => navigate('gamePath'));

    load();
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      addons = (await window.uhm.listAddons()) || [];
      // Make names available to the install/manage/done pages.
      addons.forEach((a) => { window.ADDON_NAME_CACHE[a.id] = a.name; });
    } catch (e) {
      addons = [];
      uhmToast(t('toast.error'), 'error');
    } finally {
      loading = false;
    }
    if (!active) return;
    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById('addons-grid');
    if (!grid) return;
    if (!addons.length) {
      grid.innerHTML = window.ui.empty('', s('empty'), s('emptyHint'), '');
      return;
    }
    grid.innerHTML = addons.map(renderCard).join('');
    grid.querySelectorAll('[data-action="install"]').forEach((b) => b.addEventListener('click', () => doInstall(b.dataset.id)));
    grid.querySelectorAll('[data-action="remove"]').forEach((b) => b.addEventListener('click', () => doRemove(b.dataset.id)));
    grid.querySelectorAll('[data-action="reinstall"]').forEach((b) => b.addEventListener('click', () => doInstall(b.dataset.id)));
  }

  function renderCard(a) {
    const inst = installedEntry(a.id);
    const name = loc(a.name) || a.id;
    const desc = loc(a.description);
    const gamePath = window.appState.settings && window.appState.settings.gamePath;
    const canInstall = a.available && Boolean(gamePath) && busyId === null;
    const isBusy = busyId === a.id;
    const chips = [];
    if (a.category) chips.push(window.ui.chip(a.category, 'accent'));
    if (a.version) chips.push(window.ui.chip('v' + a.version, ''));
    (a.requires || []).forEach((r) => chips.push(window.ui.chip(s('requires') + ' ' + r, 'warn')));
    (a.recommendedTiers || []).forEach((tier) => chips.push(window.ui.chip(t('tierSelect.' + tier), 'success')));

    const media = a.previewDataUrl
      ? `<img class="addon-img" src="${a.previewDataUrl}" alt="${uhmEsc(name)}" loading="lazy" />`
      : `<div class="addon-img addon-img-placeholder"><span>${uhmEsc(name.charAt(0).toUpperCase())}</span></div>`;

    let badge = '';
    if (!a.available) badge = window.ui.statusBadge(s('noFiles'), 'warn');
    else if (inst) badge = window.ui.statusBadge(s('installed'), 'ok');
    else badge = window.ui.statusBadge(s('notInstalled'), 'muted');

    const meta = a.available
      ? `<span>${s('files')}: ${a.fileCount}</span><span>${s('size')}: ${fmtBytes(a.sizeBytes)}</span>${a.author ? `<span>${s('author')}: ${uhmEsc(a.author)}</span>` : ''}`
      : `<span>${s('noFilesHint')}</span>`;

    const paths = (a.topLevel || []).slice(0, 6).map((p) => `<code>${uhmEsc(p)}</code>`).join('');

    let actions = '';
    if (isBusy) {
      actions = `<div class="addon-progress"><div class="install-progress-track"><div class="install-progress-bar" id="addon-bar-${uhmEsc(a.id)}"></div></div><div class="addon-progress-text text-dim" id="addon-progress-${uhmEsc(a.id)}">${s('installing')}</div></div>`;
    } else if (inst) {
      actions = `
        <button class="btn-secondary" data-action="reinstall" data-id="${uhmEsc(a.id)}" ${canInstall ? '' : 'disabled'}>${s('reinstall')}</button>
        <button class="btn-secondary btn-danger-soft" data-action="remove" data-id="${uhmEsc(a.id)}" ${busyId === null ? '' : 'disabled'}>${s('remove')}</button>`;
    } else {
      actions = `<button class="btn-primary" data-action="install" data-id="${uhmEsc(a.id)}" ${canInstall ? '' : 'disabled'}>${s('install')}</button>`;
    }

    return `
      <article class="addon-card ${inst ? 'is-installed' : ''} ${a.available ? '' : 'is-unavailable'}" data-id="${uhmEsc(a.id)}">
        <div class="addon-media">
          ${media}
          <div class="addon-badge">${badge}</div>
        </div>
        <div class="addon-body">
          <div class="addon-head">
            <div class="addon-name">${uhmEsc(name)}</div>
          </div>
          ${desc ? `<div class="addon-desc text-dim">${uhmEsc(desc)}</div>` : ''}
          ${chips.length ? `<div class="addon-chips">${chips.join('')}</div>` : ''}
          <div class="addon-meta title-dim">${meta}</div>
          ${paths ? `<div class="addon-paths"><span class="home-kicker">${s('paths')}:</span><div class="home-mod-path-list">${paths}</div></div>` : ''}
          ${inst ? `<div class="addon-installed-at title-dim">${s('installedAt')}: ${window.uhmFormatDate(inst.installedAt)} · ${s('files')}: ${(inst.files || []).length}</div>` : ''}
        </div>
        <div class="addon-actions">${actions}</div>
      </article>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Install / remove                                                  */
  /* ------------------------------------------------------------------ */

  function onProgress(data) {
    if (!busyId || !data || !data.mod || data.mod.id !== busyId) return;
    const bar = document.getElementById('addon-bar-' + busyId);
    const txt = document.getElementById('addon-progress-' + busyId);
    if (data.stage === 'file') {
      const pct = data.fileTotal ? Math.round((data.fileDone / data.fileTotal) * 100) : 0;
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = `${data.fileDone} / ${data.fileTotal} · ${data.currentFile || ''}`;
    } else if (data.stage === 'installed') {
      if (bar) bar.style.width = '100%';
    }
  }

  async function doInstall(id) {
    if (busyId) return;
    const addon = addons.find((a) => a.id === id);
    const gamePath = window.appState.settings && window.appState.settings.gamePath;
    if (!addon || !addon.available || !gamePath) return;

    // Re-install: revert the previous copy first so backups stay accurate.
    const prev = installedEntry(id);
    if (prev) {
      const ok = await window.uhmConfirm({
        title: s('reinstallConfirmTitle'),
        body: `<div class="text-dim">${s('reinstallConfirmBody')}</div>`,
        ok: s('reinstall'),
        cancel: t('common.cancel'),
        danger: false
      });
      if (!ok) return;
    }

    busyId = id;
    renderGrid();
    unsubscribe = window.uhm.onInstallProgress(onProgress);

    let result;
    try {
      if (prev) {
        await window.uhm.runUninstall({ files: (prev.files || []).map((f) => ({ dest: f.dest, backupPath: f.backupPath, stopAt: (window.appState.settings && window.appState.settings.gamePath) || (window.appState.manifest && window.appState.manifest.gamePath) || null })) });
      }
      const tier = (window.appState.manifest && window.appState.manifest.systemTier) || null;
      result = await window.uhm.runInstall({
        gamePath,
        tier,
        mods: [{ id, tier, dest: '', overwrite: true, exclude: [] }]
      });
    } catch (e) {
      result = { success: false, mods: [{ id, status: 'error', installedFiles: [], message: e.message || 'UNKNOWN' }] };
    }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    const mod = (result && result.mods && result.mods[0]) || { id, status: 'error', installedFiles: [] };
    await writeManifest(id, mod);
    busyId = null;
    if (!active) return;

    if (mod.status === 'installed') uhmToast(s('installedToast'), 'success');
    else if (mod.status === 'missing') uhmToast(s('noFiles'), 'warning');
    else uhmToast(t('toast.error'), 'error');
    renderGrid();
  }

  async function doRemove(id) {
    if (busyId) return;
    const prev = installedEntry(id);
    if (!prev) return;
    const ok = await window.uhmConfirm({
      title: s('removeConfirmTitle'),
      body: `<div class="text-dim">${s('removeConfirmBody')}</div>`,
      ok: s('remove'),
      cancel: t('common.cancel'),
      danger: true
    });
    if (!ok) return;

    busyId = id;
    renderGrid();
    let failed = false;
    try {
      const res = await window.uhm.runUninstall({ files: (prev.files || []).map((f) => ({ dest: f.dest, backupPath: f.backupPath, stopAt: (window.appState.settings && window.appState.settings.gamePath) || (window.appState.manifest && window.appState.manifest.gamePath) || null })) });
      failed = (res || []).some((r) => r.status === 'error');
    } catch (e) {
      failed = true;
    }
    if (!failed) {
      const manifest = window.appState.manifest || {};
      if (manifest.mods) delete manifest.mods[id];
      window.appState.manifest = manifest;
      await window.uhm.saveManifest(manifest);
      uhmToast(s('removedToast'), 'success');
    } else {
      uhmToast(t('toast.error'), 'error');
    }
    busyId = null;
    if (active) renderGrid();
  }

  async function writeManifest(id, mod) {
    const manifest = window.appState.manifest || {};
    if (!manifest.mods) manifest.mods = {};
    const existing = Array.isArray(manifest.mods[id]) ? manifest.mods[id] : [];
    const entry = {
      status: mod.status,
      tier: mod.tier || null,
      kind: 'addon',
      installedAt: new Date().toISOString(),
      files: mod.installedFiles || []
    };
    manifest.mods[id] = [entry, ...existing].slice(0, 3);
    window.appState.manifest = manifest;
    await window.uhm.saveManifest(manifest);
  }

  function destroy() {
    active = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  window.pages.addons = { render, destroy };
})();
