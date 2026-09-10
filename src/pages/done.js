/* ================================================================= */
/*  Done — summary cards + per-mod result report                     */
/* ================================================================= */

(function () {
  const MOD_ICON = window.MOD_ICON;
  const MOD_LABEL = window.MOD_LABEL;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'done.' + key); }

  function render(container, params) {
    const lang = window.appState.lang;
    const result = params || {};
    const installed = result.installed || 0;
    const missing = result.missing || 0;
    const errors = result.errors || 0;
    const skipped = result.skipped || 0;
    const cancelled = Boolean(result.cancelled);
    const state = cancelled ? 'cancelled'
      : errors > 0 ? 'error'
      : (missing > 0 || installed === 0) ? 'partial'
      : 'success';

    const icons = { success: '', partial: '', cancelled: '', error: '' };
    const manifest = window.appState.manifest || {};
    const tierName = manifest.systemTier ? t('tierSelect.' + manifest.systemTier) : '—';
    const details = (window.appState.lastInstallResult && window.appState.lastInstallResult.mods) || [];

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step5')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>

      <div class="done-wrap page-stack">
        <section class="card-sec done-hero done-${state}">
          <div class="done-icon">${icons[state]}</div>
          ${window.ui.statusBadge(s('status' + state.charAt(0).toUpperCase() + state.slice(1)), state === 'success' ? 'ok' : state === 'error' ? 'danger' : 'warn')}
          <h2 class="done-title">${s(state + 'Title')}</h2>
          <div class="text-dim done-subtitle">${s(state + 'Subtitle')}</div>
        </section>

        <section class="ui-section">
          ${window.ui.sectionHeader({ icon: '', kicker: t('kicker.result'), title: s('statsTitle'), subtitle: '' })}
          <div class="grid-3 done-stats">
            ${window.ui.statCard('', s('installedCount'), installed, 'success')}
            ${window.ui.statCard('', s('tier'), tierName, 'accent')}
            ${missing > 0 ? window.ui.statCard('', s('missingCount'), missing, 'warn') : ''}
            ${errors > 0 ? window.ui.statCard('', s('errorCount'), errors, 'danger') : ''}
            ${skipped > 0 ? window.ui.statCard('', s('skippedCount'), skipped, '') : ''}
          </div>
        </section>

        ${details.length ? `
        <section class="ui-section">
          ${window.ui.sectionHeader({ icon: '', kicker: t('kicker.report'), title: s('reportTitle'), subtitle: s('reportSub') })}
          <div class="card-sec report-list">
            ${details.map((m) => reportRow(m)).join('')}
          </div>
          <button class="btn-secondary" id="btn-copy">${s('copyReport')}</button>
        </section>` : ''}

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
    const copyBtn = document.getElementById('btn-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => copyReport(details));
  }

  function reportRow(m) {
    const stateMap = {
      installed: ['', s('statusSuccess'), 'ok'],
      missing: ['', s('missingCount'), 'warn'],
      skipped: ['', s('skippedCount'), ''],
      error: ['', s('statusError'), 'danger'],
      pending: ['', s('statusPending'), '']
    };
    const [icon, label, variant] = stateMap[m.status] || stateMap.pending;
    return `
      <div class="report-row">
        <span class="report-icon">${MOD_ICON[m.id] || ''}</span>
        <span class="report-name">${MOD_LABEL[m.id] || m.id}</span>
        ${window.ui.statusBadge(label, variant)}
      </div>`;
  }

  async function copyReport(details) {
    const lines = details.map((m) => `${MOD_LABEL[m.id] || m.id}: ${m.status}`).join('\n');
    const text = `UHM Install Report\n${new Date().toLocaleString()}\n\n${lines}`;
    let ok = false;
    try {
      // Route through the main process: renderer-side Clipboard API can be
      // blocked in sandboxed windows and `document.execCommand` is deprecated.
      if (window.uhm && typeof window.uhm.copyText === 'function') {
        ok = Boolean(await window.uhm.copyText(text));
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      ok = false;
    }
    uhmToast(ok ? s('copyDone') : t('toast.error'), ok ? 'success' : 'error');
  }

  window.pages.done = { render };
})();
