(function () {
  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const settings = window.appState.settings;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${lang === 'fa' ? '←' : '→'}</button>
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
          <div class="label">🌙 ${t('settings.theme')}</div>
          <div class="toggle-group" id="theme-toggle">
            <button data-theme="night" class="${window.appState.theme === 'night' ? 'active' : ''}">${t('settings.night')}</button>
            <button data-theme="day" class="${window.appState.theme === 'day' ? 'active' : ''}">${t('settings.day')}</button>
          </div>
        </div>

        <div class="card settings-row clickable" id="row-game-path">
          <div class="label">📁 ${t('settings.gamePath')}</div>
          <div class="value">${settings.gamePath || t('settings.notSet')}</div>
        </div>

        <div class="card settings-row clickable" id="row-about">
          <div class="label">ℹ️ ${t('settings.about')}</div>
          <div class="value">${lang === 'fa' ? '›' : '‹'}</div>
        </div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => window.navigate('showcase'));

    container.querySelectorAll('#lang-toggle button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newLang = btn.dataset.lang;
        await window.uhm.setSettings({ language: newLang });
        document.body.setAttribute('dir', window.i18n.t(newLang, 'dir'));
        window.appState.lang = newLang;
        document.getElementById('app-name-label').textContent = window.i18n.t(newLang, 'appName');
        render(container); // رفرش صفحه با زبان جدید
      });
    });

    container.querySelectorAll('#theme-toggle button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newTheme = btn.dataset.theme;
        document.body.setAttribute('data-theme', newTheme);
        window.appState.theme = newTheme;
        await window.uhm.setSettings({ theme: newTheme });
        render(container);
      });
    });

    document.getElementById('row-game-path').addEventListener('click', async () => {
      const selected = await window.uhm.browseGamePath();
      if (selected) {
        const validation = await window.uhm.validateGamePath(selected);
        if (validation.valid) {
          await window.uhm.setSettings({ gamePath: selected });
          window.appState.settings.gamePath = selected;
          render(container);
        } else {
          alert(lang === 'fa'
            ? 'این پوشه معتبر به نظر نمی‌رسد (فایل acs.exe پیدا نشد).'
            : 'This folder does not look valid (acs.exe not found).');
        }
      }
    });

    document.getElementById('row-about').addEventListener('click', () => window.navigate('about'));
  }

  window.pages.settings = { render };
})();
