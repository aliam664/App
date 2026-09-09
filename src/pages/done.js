(function () {
  function render(container, params) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'done.' + k);
    const result = params || {};
    const installed = result.installed || 0;
    const missing = result.missing || 0;

    const manifest = window.appState.manifest;
    const tierName = manifest.systemTier
      ? window.i18n.t(lang, 'tierSelect.' + manifest.systemTier)
      : '—';

    container.innerHTML = `
      <div class="done-wrap">
        <div class="done-icon">🎉</div>
        <h2 class="done-title">${s('title')}</h2>
        <div class="text-dim done-subtitle">${s('subtitle')}</div>

        <div class="done-stats">
          <div class="card stat-card">
            <div class="stat-value">${installed}</div>
            <div class="stat-label text-dim">${s('installedCount')}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${tierName}</div>
            <div class="stat-label text-dim">${s('tier')}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${missing}</div>
            <div class="stat-label text-dim">${s('missingCount')}</div>
          </div>
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
