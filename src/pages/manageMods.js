(function () {
  let busy = false;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'manageMods.' + k);
    const manifest = window.appState.manifest;
    const mods = manifest.mods || {};
    const ids = Object.keys(mods);
    const hasAny = ids.some((id) => Array.isArray(mods[id]) && mods[id].length > 0);
    busy = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <h2>${s('title')}</h2>
      </div>

      ${hasAny ? `
        <div class="manage-list">
          ${ids.map((id) => renderModCard(id, mods[id], lang, s)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">🗃</div>
          <div class="text-dim">${s('empty')}</div>
          <button class="btn-primary" id="btn-start">${t('showcase.startInstall')}</button>
        </div>
      `}
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    const startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.addEventListener('click', () => navigate('gamePath'));

    container.querySelectorAll('.manage-remove').forEach((btn) => {
      btn.addEventListener('click', () => doRemove(btn.dataset.mod, btn));
    });
  }

  function renderModCard(id, entries, lang, s) {
    const latest = entries[entries.length - 1] || entries[0] || {};
    const name = modLabel(id, lang);
    const installedCount = Array.isArray(latest.files) ? latest.files.length : 0;
    const status = latest.status || 'missing';
    const tierValue = latest.tier ? window.i18n.t(lang, 'tierSelect.' + latest.tier) : '—';
    const date = window.uhmFormatDate(latest.installedAt);

    return `
      <div class="card manage-card">
        <div class="manage-head">
          <div class="manage-name">
            <span class="manage-icon">${modIcon(id)}</span>
            <strong>${name}</strong>
            ${status === 'installed' ? '<span class="badge badge-ok">' + s('installed') + '</span>' : '<span class="badge badge-warn">' + s('missing') + '</span>'}
          </div>
          <button class="btn-secondary manage-remove" data-mod="${id}">${s('uninstall')}</button>
        </div>
        <div class="manage-meta text-dim">
          <span>${s('tier')}: ${tierValue}</span>
          <span>${s('date')}: ${date}</span>
          <span>${s('files')}: ${installedCount}</span>
        </div>
      </div>
    `;
  }

  function modLabel(id, lang) {
    const map = {
      csp: 'CSP', pure: 'PURE', ppfilter: 'PP Filter', chasecam: 'Chase Cam',
      hud: 'HUD', srp: 'SRP Light', video: 'Video'
    };
    return map[id] || id;
  }

  function modIcon(id) {
    const map = {
      csp: '🌓', pure: '✨', ppfilter: '🎨', chasecam: '📷',
      hud: '🖥', srp: '💡', video: '⚙️'
    };
    return map[id] || '📦';
  }

  async function doRemove(modId, btn) {
    if (busy) return;
    busy = true;

    const manifest = window.appState.manifest;
    const entries = manifest.mods[modId] || [];
    const latest = entries[entries.length - 1] || entries[0] || {};
    const files = latest.files || [];

    if (!files.length) {
      try {
        delete manifest.mods[modId];
        await window.uhm.saveManifest(manifest);
        window.appState.manifest = manifest;
        window.uhmToast(window.i18n.t(window.appState.lang, 'manageMods.done'), 'success');
        render(document.getElementById('page-content'));
      } finally { busy = false; }
      return;
    }

    const lang = window.appState.lang;
    const tm = (k) => window.i18n.t(lang, 'manageMods.' + k);
    const confirmed = await window.uhmConfirm({
      title: tm('deleteConfirmation'),
      body: `<div class="text-dim">${tm('noBackup')}</div>`,
      ok: tm('confirmDelete'),
      cancel: tm('cancelDelete'),
      danger: true
    });
    if (!confirmed) { busy = false; return; }

    btn.disabled = true;
    const result = await window.uhm.runUninstall({
      files: files.map((f) => ({ dest: f.dest, backupPath: f.backupPath }))
    });

    const failed = result.some((r) => r.status === 'error');
    if (!failed) {
      delete manifest.mods[modId];
      await window.uhm.saveManifest(manifest);
      window.appState.manifest = manifest;
      window.uhmToast(window.i18n.t(lang, 'manageMods.done'), 'success');
      render(document.getElementById('page-content'));
    } else {
      window.uhmToast(window.i18n.t(lang, 'toast.error'), 'error');
    }
    busy = false;
  }

  window.pages.manageMods = { render };
})();
