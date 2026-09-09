(function () {
  function render(container, params) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'done.' + k);
    const result = params || {};
    const installed = result.installed || 0;
    const missing = result.missing || 0;
    const errors = result.errors || 0;
    const skipped = result.skipped || 0;
    const cancelled = Boolean(result.cancelled);

    const state = cancelled
      ? 'cancelled'
      : errors > 0
        ? 'error'
        : (missing > 0 || installed === 0)
          ? 'partial'
          : 'success';

    const icons = { success: '🎉', partial: '⚠️', cancelled: '🛑', error: '❌' };
    const title = s(state + 'Title');
    const subtitle = s(state + 'Subtitle');
    const statusText = s('status' + state.charAt(0).toUpperCase() + state.slice(1));
    const manifest = window.appState.manifest || {};
    const tierName = manifest.systemTier
      ? window.i18n.t(lang, 'tierSelect.' + manifest.systemTier)
      : '—';

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step5')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>

      <div class="done-wrap">
        <div class="done-icon done-${state}">${icons[state]}</div>
        <div class="done-status-badge badge badge-${state}">${statusText}</div>
        <h2 class="done-title">${title}</h2>
        <div class="text-dim done-subtitle">${subtitle}</div>

        <div class="done-stats">
          <div class="card stat-card">
            <div class="stat-value">${installed}</div>
            <div class="stat-label text-dim">${s('installedCount')}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${tierName}</div>
            <div class="stat-label text-dim">${s('tier')}</div>
          </div>
          ${missing > 0 ? `<div class="card stat-card">
            <div class="stat-value">${missing}</div>
            <div class="stat-label text-dim">${s('missingCount')}</div>
          </div>` : ''}
          ${errors > 0 ? `<div class="card stat-card">
            <div class="stat-value">${errors}</div>
            <div class="stat-label text-dim">${s('errorCount')}</div>
          </div>` : ''}
          ${skipped > 0 ? `<div class="card stat-card">
            <div class="stat-value">${skipped}</div>
            <div class="stat-label text-dim">${s('skippedCount')}</div>
          </div>` : ''}
        </div>

        <div class="text-dim done-note">${s('note')}</div>

        <div class="done-actions">
          <button class="btn-primary" id="btn-manage">${s('manage')}</button>
          <button class="btn-secondary" id="btn-home">${s('backHome')}</button>
        </div>
      </div>
    `;

    document.getElementById('btn-home').addEventListener('click', () => {
      window.appState.navStack = [];
      navigate('showcase', {}, { replace: true });
    });

    document.getElementById('btn-manage').addEventListener('click', () => {
      window.appState.navStack = [];
      navigate('manageMods', {}, { replace: true });
    });
  }

  window.pages.done = { render };
})();
