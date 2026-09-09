(function () {
  const CONTACTS = [
    { icon: '💬', key: 'telegramId', handle: '@Uhm_009', url: 'https://t.me/Uhm_009' },
    { icon: '📢', key: 'telegramChannel', handle: 'Uhm_009YTC', url: 'https://t.me/Uhm_009YTC' },
    { icon: '▶️', key: 'youtube', handle: '@uhm_009', url: 'https://youtube.com/@uhm_009?si=gGaYyzv0H3lRs0NN' }
  ];

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <h2>${t('about.title')}</h2>
      </div>

      <div class="about-header">
        <img src="assets/images/logo.jpg" alt="UHM" />
        <div class="app-name">${t('appName')}</div>
        <div class="app-version">${t('common.version')} 1.0.0</div>
        <div class="version-chip">v1.0.0</div>
        <div class="tagline">${t('about.tagline')}</div>
      </div>

      <div class="text-dim" style="margin-bottom:10px;">${t('about.contactTitle')}</div>
      <div class="contact-list">
        ${CONTACTS.map((c) => `
          <div class="contact-row" data-url="${c.url}">
            <div class="icon">${c.icon}</div>
            <div class="info">
              <div class="platform">${t('about.' + c.key)}</div>
              <div class="handle">${c.handle}</div>
            </div>
            <div class="contact-arrow">${lang === 'fa' ? '‹' : '›'}</div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('settings'));
    container.querySelectorAll('.contact-row').forEach((row) => {
      row.addEventListener('click', () => window.uhm.openExternal(row.dataset.url));
    });
  }

  window.pages.about = { render };
})();
