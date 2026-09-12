/* ================================================================= */
/*  Tier select — detect system, compare, choose graphics tier       */
/* ================================================================= */

(function () {
  let selectedTier = null;
  let detecting = false;
  let detectedSpecs = null;

  const TIER_MODS = window.TIER_MODS;

  const MOD_LABEL = window.MOD_LABEL_SHORT; // فرم کوتاه برای چیپ‌ها

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'tierSelect.' + key); }

  function render(container) {
    const lang = window.appState.lang;
    selectedTier = window.appState.manifest.systemTier || null;
    detecting = false;
    detectedSpecs = null;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step3')}</div>
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="tier-wrap page-stack">
        <div class="card-sec tier-auto" id="tier-auto">
          <div class="tier-auto-head">
            <div>
              <div class="card-sec-title">${s('autoTitle')}</div>
              <div class="card-sec-sub">${s('autoSub')}</div>
            </div>
            <button class="btn-secondary" id="btn-autodetect">${s('autoDetect')}</button>
          </div>
          <div class="tier-auto-info" id="tier-auto-info"></div>
        </div>

        ${renderTiers(lang)}
        <div class="text-dim tier-manual-note">${s('manualNote')}</div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('baseModsCheck'));
    document.getElementById('btn-autodetect').addEventListener('click', detectAction);
    wireTierCards(container);
    document.getElementById('btn-continue').addEventListener('click', () => {
      if (!selectedTier) return;
      window.appState.installPlan = buildPlan(selectedTier);
      navigate('install', { plan: window.appState.installPlan });
    });
  }

  function renderTiers(lang) {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '', kicker: t('kicker.presets'), title: s('tiersTitle'), subtitle: s('tiersSub') })}
        <div class="tier-grid">
          ${window.TIER_DEFINITIONS.map((tier) => renderTier(tier)).join('')}
        </div>
      </section>
    `;
  }

  // Five start lights; the tier's index decides how many are lit.
  function tierLights(tierId) {
    const order = window.TIER_DEFINITIONS.map((t) => t.id);
    const lit = order.indexOf(tierId) + 1;
    let html = '';
    for (let i = 1; i <= 5; i += 1) html += `<i class="${i <= lit ? 'on' : ''}"></i>`;
    return html;
  }

  function renderTier(tier) {
    const label = s(tier.id);
    const mods = (TIER_MODS[tier.id] || []).map((id) =>
      `<span class="ui-chip">${MOD_LABEL[id]}</span>`
    ).join('');
    return `
      <button class="tier-card ${selectedTier === tier.id ? 'selected' : ''} ${detectedSpecs && detectedSpecs.suggestedTier === tier.id ? 'recommended' : ''}" data-tier="${tier.id}">
        <img class="tier-img" src="${tier.image}" alt="${label}" />
        <div class="tier-icon">${tier.icon}</div>
        <div class="tier-name">${label}</div>
        <div class="tier-lights" aria-hidden="true">${tierLights(tier.id)}</div>
        <div class="tier-desc text-dim">${s(tier.id + 'Desc')}</div>
        <div class="tier-mods">${mods}</div>
        ${detectedSpecs && detectedSpecs.suggestedTier === tier.id ? `<div class="tier-rec">${s('recommended')}</div>` : ''}
        <div class="tier-check" aria-hidden="true"></div>
      </button>
    `;
  }

  function wireTierCards(container) {
    container.querySelectorAll('.tier-card').forEach((card) => {
      card.addEventListener('click', () => {
        selectedTier = card.dataset.tier;
        container.querySelectorAll('.tier-card').forEach((c) => { c.classList.remove('selected', 'just-selected'); });
        card.classList.add('selected', 'just-selected');
        document.getElementById('btn-continue').disabled = false;
      });
    });
  }

  async function detectAction() {
    if (detecting) return;
    detecting = true;
    const btn = document.getElementById('btn-autodetect');
    const info = document.getElementById('tier-auto-info');
    btn.disabled = true;
    btn.textContent = s('detecting');
    info.innerHTML = '<div class="loader"></div><div class="text-dim">' + s('detecting') + '</div>';

    try {
      const specs = await window.uhm.detectSystemSpecs();
      detectedSpecs = specs;
      renderDetectedInfo(info, specs);
      rerenderRecommended(btn);
    } catch (e) {
      info.innerHTML = `<div class="text-dim">${s('notDetected')}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = s('autoDetect');
      detecting = false;
    }
  }

  function rerenderRecommended(btn) {
    // re-render tier cards to show the recommended hint
    const wrap = document.querySelector('.tier-wrap');
    if (!wrap) return;
    const grid = wrap.querySelector('.tier-grid');
    if (grid) {
      grid.innerHTML = window.TIER_DEFINITIONS.map((tier) => renderTier(tier)).join('');
      wireTierCards(wrap);
      const continueBtn = document.getElementById('btn-continue');
      if (continueBtn) continueBtn.disabled = !selectedTier;
    }
  }

  function renderDetectedInfo(info, specs) {
    const tierLabel = specs.suggestedTier ? s(specs.suggestedTier) : '—';
    const cores = specs.cpuCores ? `${specs.cpuCores} ${s('cores')}` : '—';
    const constrained = Boolean(specs.constrained) || /-limited$/.test(specs.detectedBy || '');
    const reasonKey = constrained ? 'reasonLimited'
      : specs.detectedBy === 'vram' ? 'reasonVram'
      : specs.detectedBy === 'gpu' ? 'reasonGpu' : 'reasonSpec';
    const reason = s(reasonKey);

    info.innerHTML = `
      <div class="tier-detect-grid">
        ${window.ui.infoRow(s('gpu'), specs.gpuName || s('unknownGpu'), 'accent')}
        ${window.ui.infoRow(s('vram'), specs.gpuVramGb ? specs.gpuVramGb + ' GB' : '—')}
        ${window.ui.infoRow(s('cpu'), specs.cpuName ? `${specs.cpuName} (${cores})` : '—')}
        ${window.ui.infoRow(s('ram'), specs.totalMemGb ? specs.totalMemGb + ' GB' : '—')}
      </div>
      <div class="tier-reason">${reason}</div>
      ${specs.gpuVramGb && specs.gpuVramGb <= 2 ? `<div class="text-dim">${s('vramLowNote')}</div>` : ''}
      <button class="btn-primary" id="btn-use-suggest">
        ${s('useSuggestion')} <strong>${tierLabel}</strong>
      </button>
    `;

    document.getElementById('btn-use-suggest').addEventListener('click', () => {
      if (!specs.suggestedTier) return;
      selectedTier = specs.suggestedTier;
      document.querySelectorAll('.tier-card').forEach((c) => c.classList.remove('selected'));
      const card = document.querySelector(`.tier-card[data-tier="${specs.suggestedTier}"]`);
      if (card) card.classList.add('selected');
      document.getElementById('btn-continue').disabled = false;
    });
  }

  function buildPlan(tier) {
    // The whole graphics pack is ONE install unit: mods/graphics/<tier>/ is a
    // mirror of the game folder and is copied onto the game root.
    // If the user chose to keep an existing CSP/PURE, their paths are excluded.
    const keep = window.appState.overwriteDecisions || {};
    const exclude = [];
    Object.keys(window.BASE_MOD_PATHS || {}).forEach((base) => {
      if (keep[base] === false) exclude.push(...window.BASE_MOD_PATHS[base]);
    });
    const mods = [{ id: window.GRAPHICS_PACK_ID, tier, dest: '', overwrite: true, exclude }];
    return { tier, gamePath: window.appState.settings.gamePath, mods };
  }

  window.pages.tierSelect = { render };
})();
