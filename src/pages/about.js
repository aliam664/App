/* ================================================================= */
/*  About — pack features, contents, FAQ, contacts                   */
/* ================================================================= */

(function () {
  const CONTACTS = [
    { icon: '', key: 'telegramId', handle: '@Uhm_009', url: 'https://t.me/Uhm_009' },
    { icon: '', key: 'telegramChannel', handle: 'Uhm_009YTC', url: 'https://t.me/Uhm_009YTC' },
    { icon: '', key: 'youtube', handle: '@uhm_009', url: 'https://youtube.com/@uhm_009?si=gGaYyzv0H3lRs0NN' }
  ];

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'about.' + key); }

  function render(container) {
    const lang = window.appState.lang;
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="page-stack">
        ${renderHero(lang)}
        ${renderFeatures()}
        ${renderDonate()}
        ${renderInsidePack(lang)}
        ${renderFaq()}
        ${renderContacts()}
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('settings'));
    container.querySelectorAll('.contact-row').forEach((row) => {
      row.addEventListener('click', () => window.uhm.openExternal(row.dataset.url));
    });
    const donateRow = document.getElementById('row-donate');
    if (donateRow) donateRow.addEventListener('click', () => navigate('donate'));
  }

  function renderHero(lang) {
    return `
      <section class="ui-section about-hero">
        <div class="about-header">
          <img src="assets/images/logo.jpg" alt="UHM" />
          <div>
            <div class="app-name">${t('appName')}</div>
            <div class="text-dim app-version">${t('common.version')} ${window.appState.manifest.appVersion || '1.0.0'}</div>
            <div class="about-tagline">${s('tagline')}</div>
          </div>
          <div class="about-badges">
            ${window.ui.statusBadge('v' + (window.appState.manifest.appVersion || '1.0.0'), 'accent')}
            ${window.ui.statusBadge('AC', 'ok')}
            ${window.ui.statusBadge('CSP / PURE', 'ok')}
          </div>
        </div>
      </section>
    `;
  }

  function renderFeatures() {
    const f = (icon, titleKey, descKey, accent) => `
      <div class="card-sec about-feature ${accent ? 'about-feature-' + accent : ''}">
        <div class="about-feature-icon">${icon}</div>
        <div>
          <div class="card-sec-title">${s(titleKey)}</div>
          <div class="card-sec-sub">${s(descKey)}</div>
        </div>
      </div>`;
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: 'Features', title: s('featuresTitle'), subtitle: s('featuresSub') })}
        <div class="grid-2">
          ${f('', 'featInstall', 'featInstallDesc', 'accent')}
          ${f('', 'featDetect', 'featDetectDesc')}
          ${f('', 'featTiers', 'featTiersDesc')}
          ${f('', 'featBackup', 'featBackupDesc', 'success')}
          ${f('', 'featLibrary', 'featLibraryDesc')}
          ${f('', 'featSafe', 'featSafeDesc')}
        </div>
      </section>
    `;
  }

  function renderDonate() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: '', title: s('donateTitle'), subtitle: s('donateDesc') })}
        <div class="card-sec about-donate" id="row-donate">
          <div class="about-mod-icon"></div>
          <div class="about-mod-body">
            <div class="about-mod-name">${s('donateTitle')}</div>
            <div class="text-dim">${s('donateDesc')}</div>
          </div>
          <span class="contact-arrow">${window.appState.lang === 'fa' ? '‹' : '›'}</span>
        </div>
      </section>`;
  }

  function renderInsidePack(lang) {
    const mods = (window.MOD_DEFINITIONS || []).map((m) => {
      const name = t('showcase.' + (m.nameKey || m.id));
      const desc = t('showcase.' + (m.descKey || m.nameKey + 'Desc'));
      return `
        <div class="about-mod-row">
          <span class="about-mod-icon">${m.icon}</span>
          <div class="about-mod-body">
            <div class="about-mod-name">${name}</div>
            <div class="text-dim">${desc}</div>
          </div>
        </div>`;
    }).join('');
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: 'Pack', title: s('packTitle'), subtitle: s('packSub') })}
        <div class="card-sec about-mods">${mods}</div>
      </section>
    `;
  }

  function renderFaq() {
    const faqs = [1, 2, 3, 4].map((n) => `
      <details class="about-faq">
        <summary>${s('faq' + n + 'Q')}</summary>
        <div class="about-faq-a">${s('faq' + n + 'A')}</div>
      </details>`).join('');
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: 'FAQ', title: s('faqTitle'), subtitle: s('faqSub') })}
        <div class="stack-gap">${faqs}</div>
      </section>
    `;
  }

  function renderContacts() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: 'Contact', title: s('contactTitle'), subtitle: s('contactSub') })}
        <div class="stack-gap">
          ${CONTACTS.map((c) => `
            <div class="card-sec contact-row" data-url="${c.url}">
              <div class="about-mod-icon">${c.icon}</div>
              <div class="about-mod-body">
                <div class="about-mod-name">${s(c.key)}</div>
                <div class="text-dim" dir="ltr" style="display:inline-block;">${c.handle}</div>
              </div>
              <span class="contact-arrow">${window.appState.lang === 'fa' ? '‹' : '›'}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  window.pages.about = { render };
})();
