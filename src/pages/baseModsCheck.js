(function () {
  let checking = false;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'baseModsCheck.' + k);
    checking = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step2')}</div>
          <h2>${s('title')}</h2>
        </div>
      </div>

      <div class="basecheck-wrap" id="basecheck-wrap">
        <div class="card">
          <div class="loader"></div>
          <div class="text-dim" style="text-align:center;">${s('checking')}</div>
        </div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('gamePath'));
    document.getElementById('btn-continue').addEventListener('click', () => {
      navigate('tierSelect');
    });

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

    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'baseModsCheck.' + k);

    const wrap = document.getElementById('basecheck-wrap');
    wrap.innerHTML = `
      <div class="basecheck-note text-dim">${s('noteInstalled')}</div>
      <div class="card basecheck-row">
        <div class="basecheck-title">${result.csp.found ? s('cspFound') : s('cspNotFound')}</div>
        ${result.csp.found ? renderOverwritePrompt('csp', s) : ''}
      </div>
      <div class="card basecheck-row">
        <div class="basecheck-title">${result.pure.found ? s('pureFound') : s('pureNotFound')}</div>
        ${result.pure.found ? renderOverwritePrompt('pure', s) : ''}
      </div>
    `;

    wireOverwriteButtons(container, result);
    updateContinueState(result);
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
    const cspDecided = !result.csp.found ||
      document.querySelector('.overwrite-btn[data-mod="csp"].selected');
    const pureDecided = !result.pure.found ||
      document.querySelector('.overwrite-btn[data-mod="pure"].selected');
    document.getElementById('btn-continue').disabled = !(cspDecided && pureDecided);
  }

  window.pages.baseModsCheck = { render };
})();
