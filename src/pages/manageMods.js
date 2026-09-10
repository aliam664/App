/* ================================================================= */
/*  Manage mods — installed mods, version history, uninstall         */
/* ================================================================= */

(function () {
  let busy = false;
  const MOD_ICON = window.MOD_ICON;
  const MOD_LABEL = window.MOD_LABEL;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'manageMods.' + key); }

  function render(container) {
    const manifest = window.appState.manifest;
    const mods = (manifest && manifest.mods) || {};
    const ids = Object.keys(mods).filter((id) => Array.isArray(mods[id]) && mods[id].length > 0);
    const hasAny = ids.length > 0;
    busy = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(window.appState.lang)}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="page-stack">
        ${hasAny ? renderSummary(ids, mods) : ''}
        ${hasAny ? `
          <section class="ui-section">
            ${window.ui.sectionHeader({ icon: '', kicker: 'Installed', title: s('modsTitle'), subtitle: s('modsSub') })}
            <div class="manage-list">
              ${ids.map((id) => renderModCard(id, mods[id])).join('')}
            </div>
          </section>
        ` : `
          <section class="ui-section">
            ${window.ui.empty('', s('empty'), '', `<button class="btn-primary" id="btn-start">${t('showcase.startInstall')}</button>`)}
          </section>
        `}
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    const startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.addEventListener('click', () => navigate('gamePath'));
    container.querySelectorAll('.manage-remove').forEach((btn) => btn.addEventListener('click', () => doRemove(btn.dataset.mod, btn)));
    container.querySelectorAll('.manage-toggle').forEach((btn) => btn.addEventListener('click', () => {
      const card = btn.closest('.manage-card');
      if (card) card.classList.toggle('expanded');
    }));
  }

  function renderSummary(ids, mods) {
    const installed = ids.filter((id) => mods[id][0] && (mods[id][0].status === 'installed')).length;
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: 'Summary', title: s('summaryTitle'), subtitle: '' })}
        <div class="grid-3">
          ${window.ui.statCard('', s('modsTitle'), ids.length, 'accent')}
          ${window.ui.statCard('', s('installed'), installed, 'success')}
          ${window.ui.statCard('', s('versions'), ids.reduce((a, id) => a + mods[id].length, 0), '')}
        </div>
      </section>
    `;
  }

  function renderModCard(id, entries) {
    const latest = entries[0] || entries[entries.length - 1] || {};
    const name = MOD_LABEL[id] || id;
    const installedCount = Array.isArray(latest.files) ? latest.files.length : 0;
    const status = latest.status || 'missing';
    const tierValue = latest.tier ? t('tierSelect.' + latest.tier) : '—';
    const date = window.uhmFormatDate(latest.installedAt);
    const files = (latest.files || []).slice(0, 12);
    const history = entries.map((e, i) => `
      <div class="history-row">
        <span class="history-version">v${entries.length - i}</span>
        <span class="history-status">${statusLabel(e.status)}</span>
        <span class="title-dim">${window.uhmFormatDate(e.installedAt)}</span>
      </div>`).join('');

    return `
      <div class="card-sec manage-card">
        <div class="manage-head">
          <div class="manage-name">
            <span class="manage-icon">${MOD_ICON[id] || ''}</span>
            <strong>${name}</strong>
            ${status === 'installed' ? window.ui.statusBadge(s('installed'), 'ok') : window.ui.statusBadge(s('missing'), 'warn')}
          </div>
          <div class="manage-actions">
            <button class="btn-secondary manage-toggle">${s('history')}</button>
            <button class="btn-secondary manage-remove" data-mod="${id}">${s('uninstall')}</button>
          </div>
        </div>
        <div class="manage-meta title-dim">
          <span>${s('tier')}: ${tierValue}</span>
          <span>${s('date')}: ${date}</span>
          <span>${s('files')}: ${installedCount}</span>
        </div>
        ${files.length ? `<div class="manage-files"><span class="field-label">${s('installedFiles')}:</span><div class="home-mod-path-list">${files.map((f) => `<code>${uhmEsc(f.dest || '')}</code>`).join('')}</div></div>` : ''}
        <div class="manage-history">
          <div class="history-list">${history}</div>
        </div>
      </div>
    `;
  }

  function statusLabel(status) {
    if (status === 'installed') return s('installed');
    if (status === 'skipped') return s('kept');
    if (status === 'error') return s('error');
    if (status === 'missing') return s('missing');
    return status || '—';
  }

  async function doRemove(modId, btn) {
    if (busy) return;
    busy = true;
    const manifest = window.appState.manifest;
    const entries = manifest.mods[modId] || [];
    const latest = entries[0] || entries[entries.length - 1] || {};
    const files = latest.files || [];

    if (!files.length) {
      try {
        delete manifest.mods[modId];
        await window.uhm.saveManifest(manifest);
        window.appState.manifest = manifest;
        uhmToast(s('done'), 'success');
        render(document.getElementById('page-content'));
      } finally { busy = false; }
      return;
    }

    const confirmed = await window.uhmConfirm({
      title: s('deleteConfirmation'),
      body: `<div class="text-dim">${s('noBackup')}</div>`,
      ok: s('confirmDelete'),
      cancel: s('cancelDelete'),
      danger: true
    });
    if (!confirmed) { busy = false; return; }

    btn.disabled = true;
    const result = await window.uhm.runUninstall({ files: files.map((f) => ({ dest: f.dest, backupPath: f.backupPath })) });
    const failed = result.some((r) => r.status === 'error');
    if (!failed) {
      delete manifest.mods[modId];
      await window.uhm.saveManifest(manifest);
      window.appState.manifest = manifest;
      uhmToast(s('done'), 'success');
      render(document.getElementById('page-content'));
    } else {
      uhmToast(t('toast.error'), 'error');
    }
    busy = false;
  }

  window.pages.manageMods = { render };
})();
