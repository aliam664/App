/* ================================================================= */
/*  Base mods check — CSP / PURE presence and update decision        */
/* ================================================================= */

(function () {
  let checking = false;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'baseModsCheck.' + key); }

  function render(container) {
    const lang = window.appState.lang;
    checking = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step2')}</div>
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="basecheck-wrap page-stack" id="basecheck-wrap">
        <div class="card-sec loading-card">
          <div class="loader"></div>
          <div class="text-dim">${s('checking')}</div>
        </div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('gamePath'));
    document.getElementById('btn-continue').addEventListener('click', () => navigate('tierSelect'));
    runCheck(container);
  }

  async function runCheck(container) {
    if (checking) return;
    checking = true;
    const gamePath = window.appState.settings && window.appState.settings.gamePath;
    const result = await window.uhm.checkBaseMods(gamePath);
    checking = false;

    window.appState.overwriteDecisions = {
      csp: !result.csp.found,
      pure: !result.pure.found
    };

    const wrap = document.getElementById('basecheck-wrap');
    wrap.innerHTML = `
      <div class="card-sec basecheck-note">
        <span class="basecheck-note-icon">🛡️</span>
        <div>
          <div class="card-sec-title">${s('noteTitle')}</div>
          <div class="card-sec-sub">${s('noteInstalled')}</div>
        </div>
      </div>
      ${modCheckRow('csp', result.csp, s)}
      ${modCheckRow('pure', result.pure, s)}
      ${renderSummary(result, s)}
    `;

    wireOverwriteButtons(container, result);
    updateContinueState(result);
  }

  function modCheckRow(key, data, s) {
    const found = data && data.found;
    const markers = (data && data.markers) || [];
    const badge = found
      ? window.ui.statusBadge(s('found'), 'ok')
      : window.ui.statusBadge(s('notFound'), 'warn');
    const action = found ? s('willOverwrite') : s('willInstall');
    return `
      <div class="card-sec basecheck-row ${found ? 'found' : 'missing'}">
        <div class="basecheck-head">
          <div class="basecheck-title">${found ? '✅' : '⬜'} ${s(key + 'Name')}</div>
          ${badge}
        </div>
        <div class="basecheck-action">${action}</div>
        ${markers.length ? `
          <div class="basecheck-markers">
            <div class="field-label">${s('foundMarkers')}:</div>
            <div class="home-mod-path-list">${markers.map((m) => `<code>${uhmEsc(m)}</code>`).join('')}</div>
          </div>` : ''}
        ${found ? renderOverwritePrompt(key, s) : ''}
      </div>
    `;
  }

  function renderOverwritePrompt(modKey, s) {
    return `
      <div class="overwrite-box">
        <div class="text-dim">${s('overwriteQuestion')}</div>
        <div class="overwrite-actions">
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="yes">${s('yes')}</button>
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="no">${s('no')}</button>
        </div>
      </div>
    `;
  }

  function renderSummary(result, s) {
    const foundCount = (result.csp.found ? 1 : 0) + (result.pure.found ? 1 : 0);
    return `
      <div class="basecheck-summary">
        ${window.ui.statCard('🧩', s('summaryTitle'), s('summaryValue').replace('{n}', foundCount), foundCount ? 'accent' : '')}
      </div>
    `;
  }

  function wireOverwriteButtons(container, result) {
    container.querySelectorAll('.overwrite-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modKey = btn.dataset.mod;
        const choice = btn.dataset.choice === 'yes';
        window.appState.overwriteDecisions[modKey] = choice;
        const siblingBtns = btn.parentElement.querySelectorAll('.overwrite-btn');
        siblingBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateContinueState(result);
      });
    });
  }

  function updateContinueState(result) {
    const cspDecided = !result.csp.found || document.querySelector('.overwrite-btn[data-mod="csp"].selected');
    const pureDecided = !result.pure.found || document.querySelector('.overwrite-btn[data-mod="pure"].selected');
    document.getElementById('btn-continue').disabled = !(cspDecided && pureDecided);
  }

  window.pages.baseModsCheck = { render };
})();
