(function () {
  let selectedTier = null;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'tierSelect.' + k);
    selectedTier = window.appState.manifest.systemTier || null;

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
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('baseModsCheck'));

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
