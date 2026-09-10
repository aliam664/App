/* ================================================================= */
/*  Settings — language, theme, game path, system, data              */
/* ================================================================= */

(function () {
  let specs = null;
  let specBusy = false;
  let trashCount = 0;
  let dirty = false;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'settings.' + key); }

  function render(container) {
    const lang = window.appState.lang;
    const settings = window.appState.settings;
    const manifest = window.appState.manifest;
    specs = null;
    specBusy = false;
    dirty = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <h2>${t('settings.title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="page-stack">
        ${renderAppearance(settings, manifest, lang)}
        ${renderSystemCard(settings)}
        ${renderGamePathCard(settings)}
        ${renderInstallCard(manifest)}
        ${renderDataCard()}
        ${renderAboutCard(lang)}
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    wireAppearance(container);
    wireSystem(container);
    wireGamePath(container);
    wireInstall(container);
    wireData(container);
    document.getElementById('row-about').addEventListener('click', () => navigate('about'));

    detectSystem();
    refreshTrash();
  }

  /* ---------------- templates ---------------- */

  function renderAppearance(settings, manifest, lang) {
    const tierName = manifest.systemTier ? t('tierSelect.' + manifest.systemTier) : t('settings.notDetected');
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🎛️', kicker: 'Appearance', title: s('appearanceTitle'), subtitle: s('appearanceSub') })}
        <div class="stack-gap">
          <div class="card-sec settings-row">
            <div class="settings-row-body">
              <div class="card-sec-title">🌐 ${s('language')}</div>
              <div class="card-sec-sub">${s('languageSub')}</div>
            </div>
            <div class="toggle-group" id="lang-toggle">
              <button data-lang="fa" class="${lang === 'fa' ? 'active' : ''}">فارسی</button>
              <button data-lang="en" class="${lang === 'en' ? 'active' : ''}">English</button>
              <button data-lang="zh" class="${lang === 'zh' ? 'active' : ''}">中文</button>
              <button data-lang="ja" class="${lang === 'ja' ? 'active' : ''}">日本語</button>
            </div>
          </div>

          <div class="card-sec settings-row">
            <div class="settings-row-body">
              <div class="card-sec-title">${window.appState.theme === 'night' ? '🌙' : '☀️'} ${s('theme')}</div>
              <div class="card-sec-sub">${s('themeSub')}</div>
            </div>
            <div class="toggle-group" id="theme-toggle">
              <button data-theme="night" class="${window.appState.theme === 'night' ? 'active' : ''}">${s('night')}</button>
              <button data-theme="day" class="${window.appState.theme === 'day' ? 'active' : ''}">${s('day')}</button>
            </div>
          </div>

          <div class="card-sec settings-row">
            <div class="settings-row-body">
              <div class="card-sec-title">📊 ${s('installInfo')}</div>
              <div class="card-sec-sub">${s('installInfoSub')}</div>
            </div>
            <div class="settings-info-value">
              <div>${s('tier')}: <strong>${tierName}</strong></div>
              <div>${s('modsCount')}: <strong>${manifest.mods ? Object.keys(manifest.mods).length : 0}</strong></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderSystemCard() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🖥️', kicker: 'System', title: s('systemTitle'), subtitle: s('systemSub') })}
        <div class="card-sec">
          <div class="settings-row" style="align-items:center;">
            <div class="settings-row-body">
              <div class="card-sec-title">${s('detectTitle')}</div>
              <div class="card-sec-sub">${s('detectSub')}</div>
            </div>
            <button class="btn-secondary" id="btn-detect-specs">${s('detect')}</button>
          </div>
          <div class="system-info" id="system-info">
            <div class="loader"></div>
            <div class="text-dim" style="text-align:center;">${s('detecting')}</div>
          </div>
        </div>
      </section>
    `;
  }

  function renderGamePathCard(settings) {
    const has = Boolean(settings.gamePath);
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '📁', kicker: 'Game', title: s('gamePath'), subtitle: s('gamePathSub') })}
        <div class="card-sec settings-row clickable" id="row-game-path">
          <div class="settings-row-body">
            <div class="card-sec-title">${s('gamePath')}</div>
            <div class="path-value ${has ? '' : 'text-dim'}" dir="ltr" style="text-align:end;">${settings.gamePath ? uhmEsc(settings.gamePath) : s('notSet')}</div>
          </div>
          ${window.ui.statusBadge(has ? s('pathSet') : s('pathNotSet'), has ? 'ok' : 'warn')}
        </div>
      </section>
    `;
  }

  function renderInstallCard(manifest) {
    const lastInstall = manifest.lastInstallDate ? window.uhmFormatDate(manifest.lastInstallDate) : t('settings.installInfoNone');
    const tierName = manifest.systemTier ? t('tierSelect.' + manifest.systemTier) : t('settings.notDetected');
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🗂️', kicker: 'Install', title: s('installSummary'), subtitle: s('installSummarySub') })}
        <div class="stack-gap">
          ${window.ui.infoRow(s('tier'), tierName, 'accent')}
          ${window.ui.infoRow(s('lastInstall'), lastInstall)}
          ${window.ui.infoRow(s('modsCount'), manifest.mods ? Object.keys(manifest.mods).length : 0)}
        </div>
      </section>
    `;
  }

  function renderDataCard() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🧹', kicker: 'Storage', title: s('dataTitle'), subtitle: s('dataSub') })}
        <div class="card-sec">
          <div class="settings-row">
            <div class="settings-row-body">
              <div class="card-sec-title">🗑 ${s('trashTitle')}</div>
              <div class="card-sec-sub">${s('trashSub')}</div>
            </div>
            <button class="btn-secondary" id="btn-empty-trash">${s('emptyTrash')} (<span id="trash-count">0</span>)</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderAboutCard(lang) {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: 'ℹ️', kicker: 'About', title: s('about'), subtitle: s('aboutSub') })}
        <div class="card-sec settings-row clickable" id="row-about">
          <div class="settings-row-body">
            <div class="card-sec-title">${t('appName')}</div>
            <div class="card-sec-sub">${t('common.version')} ${window.appState.manifest.appVersion || '1.0.0'}</div>
          </div>
          <span class="settings-arrow">${lang === 'fa' ? '‹' : '›'}</span>
        </div>
      </section>
    `;
  }

  /* ---------------- wiring ---------------- */

  function wireAppearance(container) {
    container.querySelectorAll('#lang-toggle button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newLang = btn.dataset.lang;
        if (newLang === window.appState.lang) return;
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
        uhmToast(window.i18n.t(window.appState.lang, 'toast.theme'), 'success', 1300);
      });
    });
  }

  function wireSystem(container) {
    document.getElementById('btn-detect-specs').addEventListener('click', () => detectSystem(true));
  }

  async function detectSystem(force = false) {
    if (specBusy) return;
    specBusy = true;
    const info = document.getElementById('system-info');
    if (info) info.innerHTML = '<div class="loader"></div><div class="text-dim" style="text-align:center;">' + s('detecting') + '</div>';
    try {
      specs = await window.uhm.detectSystemSpecs(force ? { force: true } : undefined);
      renderSystemInfo();
    } catch (e) {
      if (info) info.innerHTML = `<div class="text-dim">${s('notDetected')}</div>`;
    } finally {
      specBusy = false;
    }
  }

  function renderSystemInfo() {
    const info = document.getElementById('system-info');
    if (!info) return;
    if (!specs) { info.innerHTML = `<div class="text-dim">${s('notDetected')}</div>`; return; }
    const tierLabel = specs.suggestedTier ? t('tierSelect.' + specs.suggestedTier) : '—';
    const constrained = Boolean(specs.constrained) || /-limited$/.test(specs.detectedBy || '');
    info.innerHTML = `
      <div class="system-info-grid">
        ${window.ui.infoRow('GPU', specs.gpuName || s('unknown'), 'accent')}
        ${window.ui.infoRow('VRAM', specs.gpuVramGb ? specs.gpuVramGb + ' GB' : '—')}
        ${window.ui.infoRow('CPU', specs.cpuName || '—')}
        ${window.ui.infoRow('Cores', specs.cpuCores || '—')}
        ${window.ui.infoRow('RAM', specs.totalMemGb ? specs.totalMemGb + ' GB' : '—')}
        ${window.ui.infoRow('Driver', specs.driverVersion || '—')}
      </div>
      <div class="system-recommend">
        <span class="title-dim">${s('recommended')}</span>
        <strong>${tierLabel}</strong>
        ${window.ui.statusBadge(constrained ? s('limited') : specs.detectedBy === 'gpu' ? s('byGpu') : s('bySpecs'), constrained ? 'warn' : 'ok')}
      </div>
    `;
  }

  function wireGamePath(container) {
    document.getElementById('row-game-path').addEventListener('click', async () => {
      const selected = await window.uhm.browseGamePath();
      if (!selected) return;
      const validation = await window.uhm.validateGamePath(selected);
      if (validation.valid) {
        await window.uhm.setSettings({ gamePath: selected });
        window.appState.settings.gamePath = selected;
        render(container);
        uhmToast(t('toast.saved'), 'success');
      } else {
        uhmToast(t('toast.invalidGamePath'), 'error');
      }
    });
  }

  function wireInstall(container) {
    // nothing to wire beyond rows
  }

  function wireData(container) {
    document.getElementById('btn-empty-trash').addEventListener('click', async () => {
      if (trashCount <= 0) return;
      const confirmed = await window.uhmConfirm({
        title: s('emptyTrashConfirm'),
        ok: s('emptyTrash'),
        cancel: t('common.cancel'),
        danger: true
      });
      if (!confirmed) return;
      const result = await window.uhm.emptyTrash();
      if (result && result.success) {
        trashCount = 0;
        const el = document.getElementById('trash-count');
        if (el) el.textContent = '0';
        uhmToast(s('emptyTrashDone'), 'success');
      } else {
        uhmToast(t('toast.error'), 'error');
      }
    });
  }

  async function refreshTrash() {
    try {
      const list = await window.uhm.listTrash();
      trashCount = list.length;
      const el = document.getElementById('trash-count');
      if (el) el.textContent = String(trashCount);
    } catch (e) { /* ignore */ }
  }

  window.pages.settings = { render };
})();
