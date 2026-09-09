(function () {
  let unsubscribe = null;
  let currentResults = [];
  let cancelled = false;
  let active = false;
  let logged = {};

  function render(container, params) {
    active = true;
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'install.' + k);

    const plan = (params && params.plan) || window.appState.installPlan;
    if (!plan || !plan.mods || plan.mods.length === 0) {
      navigate('tierSelect');
      return;
    }

    cancelled = false;
    currentResults = [];
    logged = {};

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step4')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>

      <div class="install-wrap">
        <div class="install-status-head">
          <div class="install-spinner" id="install-spinner"></div>
          <div class="install-status-title" id="install-status-title">${s('preparing')}</div>
        </div>

        <div class="install-progress">
          <div class="install-progress-track"><div class="install-progress-bar" id="install-bar"></div></div>
          <div class="install-progress-text" id="install-progress-text">0 / ${plan.mods.length}</div>
        </div>

        <div class="install-list" id="install-list">
          ${plan.mods.map((m, i) => `
            <div class="install-item" data-index="${i}">
              <span class="install-item-icon">${lang === 'fa' ? '⏳' : '⏳'}</span>
              <span class="install-item-name">${modLabel(m.id, lang)}</span>
              <span class="install-item-status" id="install-status-${i}">${s('statusPending')}</span>
            </div>
          `).join('')}
        </div>

        <div class="install-log" id="install-log"></div>
        <div class="text-dim install-note">${s('noteMissing')}</div>
      </div>

      <div class="wizard-footer">
        <button class="btn-secondary" id="btn-cancel">${s('cancelBtn')}</button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', async () => {
      await window.uhm.cancelInstall();
      cancelled = true;
      goBack();
    });
    document.getElementById('btn-cancel').addEventListener('click', async () => {
      await window.uhm.cancelInstall();
      cancelled = true;
      const btn = document.getElementById('btn-cancel');
      if (btn) { btn.disabled = true; btn.textContent = s('cancelled'); }
    });

    unsubscribe = window.uhm.onInstallProgress(handleProgress);

    runInstall(plan);
  }

  function modLabel(id, lang) {
    const map = {
      csp: 'CSP', pure: 'PURE', ppfilter: 'PP Filter', chasecam: 'Chase Cam',
      hud: 'HUD', srp: 'SRP Light', video: 'Video'
    };
    return map[id] || id;
  }

  function setItemState(index, state, text) {
    const el = document.getElementById('install-status-' + index);
    const item = document.querySelector(`.install-item[data-index="${index}"]`);
    if (el) el.textContent = text;
    if (item) {
      item.dataset.state = state;
      item.querySelector('.install-item-icon').textContent =
        state === 'installed' ? '✅' : state === 'error' ? '❌' : state === 'missing' ? '⚠️' : state === 'skipped' ? '🕐' : state === 'running' ? '⚙️' : '⏳';
    }
  }

  function appendLog(mod, stateText) {
    const log = document.getElementById('install-log');
    if (!log) return;
    const key = mod.id + ':' + mod.status;
    if (logged[key]) return;
    logged[key] = true;
    const line = document.createElement('div');
    line.innerHTML = `<strong>${uhmEsc(modLabel(mod.id, window.appState.lang))}</strong> — ${uhmEsc(stateText)}`;
    log.appendChild(line);
  }

  function handleProgress(data) {
    const s = (k) => window.i18n.t(window.appState.lang, 'install.' + k);
    const { done, total, mod } = data;

    if (mod && mod.id) {
      const defIndex = currentResults.findIndex((r) => r.id === mod.id);
      if (defIndex === -1) {
        currentResults.push(mod);
      } else {
        currentResults[defIndex] = mod;
      }
      const idx = currentResults.findIndex((r) => r.id === mod.id);
      let text = s('statusRunning');
      let state = 'running';
      if (mod.status === 'installed') { text = s('statusInstalled'); state = 'installed'; }
      else if (mod.status === 'missing') { text = s('statusMissing'); state = 'missing'; }
      else if (mod.status === 'skipped') { text = s('statusSkipped'); state = 'skipped'; }
      else if (mod.status === 'error') { text = s('statusError'); state = 'error'; }
      setItemState(idx, state, text);
      if (mod.status !== 'pending' && mod.status !== 'running' && mod.status !== 'start') {
        appendLog(mod, text);
      }
    }

    const bar = document.getElementById('install-bar');
    const progress = document.getElementById('install-progress-text');
    const statusTitle = document.getElementById('install-status-title');
    if (bar) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      bar.style.width = pct + '%';
    }
    if (progress) progress.textContent = `${done} / ${total}`;
    if (statusTitle) statusTitle.textContent = s(cancelled ? 'cancelled' : 'title');
  }

  async function runInstall(plan) {
    let result;
    try {
      result = await window.uhm.runInstall(plan);
    } catch (e) {
      result = { success: false, cancelled: false, error: e.message || 'UNKNOWN', mods: plan.mods.map((m) => ({ ...m, status: 'error', installedFiles: [] })) };
    }

    if (!active) return;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    window.appState.lastInstallResult = result;
    if (cancelled || (result && result.cancelled)) {
      handleFinalState(true);
    } else {
      await updateManifest(plan, result);
      if (!active) return;
      handleFinalState(Boolean(result && result.success));
    }
  }

  async function updateManifest(plan, result) {
    const manifest = window.appState.manifest || {};
    if (!manifest.mods) manifest.mods = {};
    const installedModules = (result && result.mods) || [];

    for (const mod of installedModules) {
      const id = mod.id;
      if (mod.status === 'skipped' || mod.status === 'pending') continue;
      const existingMods = Array.isArray(manifest.mods[id]) ? manifest.mods[id] : [];
      const newEntry = {
        status: mod.status,
        tier: plan.tier || null,
        installedAt: new Date().toISOString(),
        files: (mod.installedFiles || []).map((f) => f)
      };
      manifest.mods[id] = [newEntry, ...existingMods].slice(0, 3);
    }
    manifest.appVersion = manifest.appVersion || '1.0.0';
    manifest.gamePath = plan.gamePath;
    manifest.systemTier = plan.tier || null;
    manifest.lastInstallDate = new Date().toISOString();
    window.appState.manifest = manifest;
    await window.uhm.saveManifest(manifest);
  }

  function handleFinalState(success) {
    const results = window.appState.lastInstallResult;
    const mods = (results && results.mods) || [];
    const installed = mods.filter((m) => m.status === 'installed').length;
    const missing = mods.filter((m) => m.status === 'missing').length;
    const errors = mods.filter((m) => m.status === 'error').length;
    const skipped = mods.filter((m) => m.status === 'skipped').length;

    const list = document.getElementById('install-list');
    if (list) {
      list.classList.add('done');
      list.querySelectorAll('.install-item[data-state=""]').forEach((el) => {
        el.dataset.state = 'pending';
      });
    }

    setTimeout(() => {
      navigate('done', {
        installed,
        missing,
        errors,
        skipped,
        cancelled: Boolean(results && results.cancelled),
        success: Boolean(success)
      });
    }, 800);
  }

  function destroy() {
    active = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  window.pages.install = { render, destroy };
})();
