(function () {
  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const settings = window.appState.settings;
    const manifest = window.appState.manifest;

    const tierName = manifest.systemTier ? t('tierSelect.' + manifest.systemTier) : '—';
    const modsCount = manifest.mods ? Object.keys(manifest.mods).length : 0;
    const lastInstall = manifest.lastInstallDate ? window.uhmFormatDate(manifest.lastInstallDate) : t('settings.installInfoNone');

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <h2>${t('settings.title')}</h2>
      </div>

      <div class="settings-list">
        <div class="card settings-row">
          <div class="label">🌐 ${t('settings.language')}</div>
          <div class="toggle-group" id="lang-toggle">
            <button data-lang="fa" class="${lang === 'fa' ? 'active' : ''}">فارسی</button>
            <button data-lang="en" class="${lang === 'en' ? 'active' : ''}">English</button>
          </div>
        </div>

        <div class="card settings-row">
          <div class="label">${window.appState.theme === 'night' ? '🌙' : '☀️'} ${t('settings.theme')}</div>
          <div class="toggle-group" id="theme-toggle">
            <button data-theme="night" class="${window.appState.theme === 'night' ? 'active' : ''}">${t('settings.night')}</button>
            <button data-theme="day" class="${window.appState.theme === 'day' ? 'active' : ''}">${t('settings.day')}</button>
          </div>
        </div>

        <div class="card settings-row clickable" id="row-game-path">
          <div class="label">📁 ${t('settings.gamePath')}</div>
          <div class="value path-value">${settings.gamePath ? uhmEsc(settings.gamePath) : t('settings.notSet')}</div>
        </div>

        <div class="card settings-row">
          <div class="label">📊 ${t('settings.installInfo')}</div>
          <div class="value">
            <div>${t('settings.tier')}: ${tierName}</div>
            <div>${t('settings.modsCount')}: ${modsCount}</div>
            <div>${t('settings.lastInstall')}: ${lastInstall}</div>
          </div>
        </div>

        <div class="card settings-row clickable" id="row-about">
          <div class="label">ℹ️ ${t('settings.about')}</div>
          <div class="value">${lang === 'fa' ? '›' : '‹'}</div>
        </div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));

    container.querySelectorAll('#lang-toggle button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newLang = btn.dataset.lang;
        if (newLang === lang) return;
        await window.uhm.setSettings({ language: newLang });
        applyLanguage(newLang);
        window.appState.settings.language = newLang;
        render(container);
        uhmToast(window.i18n.t(newLang, 'toast.lang'), 'success', 1300);
      });
    });

    container.querySelectorAll('#theme-toggle button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newTheme = btn.dataset.theme;
        if (newTheme === window.appState.theme) return;
        await window.uhm.setSettings({ theme: newTheme });
        applyTheme(newTheme);
        window.appState.settings.theme = newTheme;
        render(container);
        uhmToast(window.i18n.t(lang, 'toast.theme'), 'success', 1300);
      });
    });

    document.getElementById('row-game-path').addEventListener('click', async () => {
      const selected = await window.uhm.browseGamePath();
      if (!selected) return;
      const validation = await window.uhm.validateGamePath(selected);
      if (validation.valid) {
        await window.uhm.setSettings({ gamePath: selected });
        window.appState.settings.gamePath = selected;
        render(container);
        uhmToast(window.i18n.t(lang, 'toast.saved'), 'success');
      } else {
        uhmToast(window.i18n.t(lang, 'toast.invalidGamePath'), 'error');
      }
    });

    document.getElementById('row-about').addEventListener('click', () => navigate('about'));
  }

  window.pages.settings = { render };
})();
