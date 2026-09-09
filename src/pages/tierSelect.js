(function () {
  let selectedTier = null;
  let detecting = false;
  let detectedSpecs = null;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'tierSelect.' + k);
    selectedTier = window.appState.manifest.systemTier || null;
    detecting = false;
    detectedSpecs = null;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step3')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>

      <div class="tier-wrap">
        <div class="text-dim tier-subtitle">${s('subtitle')}</div>

        <div class="tier-auto card" id="tier-auto">
          <button class="btn-secondary" id="btn-autodetect">${s('autoDetect')}</button>
          <div class="tier-auto-info" id="tier-auto-info"></div>
        </div>

        <div class="tier-grid">
          ${window.TIER_DEFINITIONS.map((tier) => `
            <button class="tier-card ${selectedTier === tier.id ? 'selected' : ''}" data-tier="${tier.id}">
              <img class="tier-img" src="${tier.image}" alt="${s(tier.id)}" />
              <div class="tier-icon">${tier.icon}</div>
              <div class="tier-name">${s(tier.id)}</div>
              <div class="tier-desc text-dim">${s(tier.id + 'Desc')}</div>
              <div class="tier-check">${selectedTier === tier.id ? '✓' : ''}</div>
            </button>
          `).join('')}
        </div>

        <div class="text-dim">${s('manualNote')}</div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('baseModsCheck'));
    document.getElementById('btn-autodetect').addEventListener('click', async () => {
      if (detecting) return;
      detecting = true;
      const btn = document.getElementById('btn-autodetect');
      const info = document.getElementById('tier-auto-info');
      btn.disabled = true;
      btn.textContent = s('detecting');
      info.innerHTML = '<div class="loader"></div>';

      try {
        const specs = await window.uhm.detectSystemSpecs();
        detectedSpecs = specs;
        renderDetectedInfo(info, specs, lang, s);
      } catch (e) {
        info.innerHTML = `<div class="text-dim">${s('notDetected')}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = s('autoDetect');
        detecting = false;
      }
    });

    container.querySelectorAll('.tier-card').forEach((card) => {
      card.addEventListener('click', () => {
        selectedTier = card.dataset.tier;
        container.querySelectorAll('.tier-card').forEach((c) => c.classList.remove('selected'));
        container.querySelectorAll('.tier-check').forEach((c) => (c.textContent = ''));
        card.classList.add('selected');
        card.querySelector('.tier-check').textContent = '✓';
        document.getElementById('btn-continue').disabled = false;
      });
    });

    document.getElementById('btn-continue').addEventListener('click', () => {
      if (!selectedTier) return;
      const plan = buildPlan(selectedTier);
      window.appState.installPlan = plan;
      navigate('install', { plan });
    });
  }

  function renderDetectedInfo(info, specs, lang, s) {
    const t = (k) => window.i18n.t(lang, k);
    const tierLabel = specs.suggestedTier
      ? window.i18n.t(lang, 'tierSelect.' + specs.suggestedTier)
      : '—';
    const cores = specs.cpuCores ? `${specs.cpuCores} ${s('cores')}` : '—';
    const gpuName = specs.gpuName || s('unknownGpu');
    const reasonKey = specs.detectedBy === 'vram'
      ? 'reasonVram'
      : specs.detectedBy === 'gpu'
        ? 'reasonGpu'
        : 'reasonSpec';
    const reason = s(reasonKey);

    info.innerHTML = `
      <div class="tier-auto-title">${s('detected')} ✅</div>
      <div class="tier-auto-row"><span>${s('gpu')}:</span><strong>${uhmEsc(gpuName)}</strong></div>
      ${specs.gpuVramGb ? `<div class="tier-auto-row"><span>${s('vram')}:</span><strong>${uhmEsc(specs.gpuVramGb)} GB</strong></div>` : ''}
      ${specs.driverVersion ? `<div class="tier-auto-row"><span>${s('driver')}:</span><strong>${uhmEsc(specs.driverVersion)}</strong></div>` : ''}
      <div class="tier-auto-row"><span>${s('cpu')}:</span><strong>${uhmEsc(specs.cpuName || '—')} (${cores})</strong></div>
      <div class="tier-auto-row"><span>${s('ram')}:</span><strong>${uhmEsc(specs.totalMemGb || 0)} GB</strong></div>
      <div class="tier-auto-row text-dim">📌 ${reason}</div>
      ${specs.gpuVramGb && specs.gpuVramGb <= 2 ? `<div class="tier-auto-row text-dim">${s('vramLowNote')}</div>` : ''}
      <button class="btn-primary btn-suggest" id="btn-use-suggest">
        ${s('useSuggestion')} <strong>${tierLabel}</strong>
      </button>
    `;

    document.getElementById('btn-use-suggest').addEventListener('click', () => {
      if (!specs.suggestedTier) return;
      selectTier(specs.suggestedTier, document.getElementById('page-content'));
    });
  }

  function selectTier(tier, container) {
    selectedTier = tier;
    container.querySelectorAll('.tier-card').forEach((c) => c.classList.remove('selected'));
    container.querySelectorAll('.tier-check').forEach((c) => (c.textContent = ''));
    const card = container.querySelector(`.tier-card[data-tier="${tier}"]`);
    if (card) {
      card.classList.add('selected');
      card.querySelector('.tier-check').textContent = '✓';
    }
    document.getElementById('btn-continue').disabled = false;
  }

  function buildPlan(tier) {
    const existing = window.appState.overwriteDecisions || {};
    const enabledMods = window.MOD_DEFINITIONS.filter((m) => m.enabled);

    // اگر کاربر برای CSP/PURE «خیر - حفظ کن» را انتخاب کرده باشد،
    // همان مود از پلن نصب حذف می‌شود تا نسخه‌ی قبلی بازنویسی نشود.
    const mods = enabledMods
      .filter((m) => !((m.id === 'csp' || m.id === 'pure') && existing[m.id] === false))
      .map((m) => ({
        id: m.id,
        dest: m.dest || '',
        type: m.type || 'copy',
        source: undefined,
        overwrite: true
      }));

    return {
      tier,
      gamePath: window.appState.settings.gamePath,
      mods
    };
  }

  window.pages.tierSelect = { render };
})();
