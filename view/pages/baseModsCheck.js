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
          <span>${s('continueBtn')}</span>
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
      pure: !result.pure.found,
      // Settings groups default to KEEP (overwrite = false): overwriting a
      // player's video.ini or tuned CSP settings by default is destructive
      // and was the old behaviour; keeping them is the safe default and the
      // 'no' button below is rendered pre-selected for these two groups.
      video: false,
      cspsettings: false,
      // Profile layer (Documents): applying is the recommended default —
      // video is merged (resolution preserved) and CSP files are backed
      // up, so opting in is safe and reversible.
      profilevideo: true,
      profilecsp: true
    };

    const wrap = document.getElementById('basecheck-wrap');
    wrap.innerHTML = `
      <div class="card-sec basecheck-note">
        <span class="basecheck-note-icon"></span>
        <div>
          <div class="card-sec-title">${s('noteTitle')}</div>
          <div class="card-sec-sub">${s('noteInstalled')}</div>
        </div>
      </div>
      ${modCheckRow('csp', result.csp, s)}
      ${modCheckRow('pure', result.pure, s)}
      ${modCheckRow('video', result.video, s, true)}
      ${modCheckRow('cspsettings', result.cspsettings, s, true)}
      ${modCheckRow('profilevideo', result.profilevideo, s, false, true)}
      ${modCheckRow('profilecsp', result.profilecsp, s, false, true)}
      ${renderSummary(result, s)}
    `;

    wireOverwriteButtons(container, result);
    updateContinueState(result);
  }

  function modCheckRow(key, data, s, defaultKeep, defaultApply) {
    const found = data && data.found;
    const markers = (data && data.markers) || [];
    const badge = found
      ? window.ui.statusBadge(s('found'), 'ok')
      : window.ui.statusBadge(s('notFound'), 'warn');
    const action = found ? s('willOverwrite') : s('willInstall');
    const hint = key === 'video' ? s('videoHint')
      : key === 'cspsettings' ? s('cspSettingsHint')
      : key === 'profilevideo' ? s('profilevideoHint')
      : key === 'profilecsp' ? s('profilecspHint') : '';
    return `
      <div class="card-sec basecheck-row ${found ? 'found' : 'missing'}">
        <div class="basecheck-head">
          <div class="basecheck-title">${s(key + 'Name')}</div>
          ${badge}
        </div>
        <div class="basecheck-action">${action}</div>
        ${hint ? `<div class="text-dim">${hint}</div>` : ''}
        ${markers.length ? `
          <div class="basecheck-markers">
            <div class="field-label">${s('foundMarkers')}:</div>
            <div class="home-mod-path-list">${markers.map((m) => `<code>${uhmEsc(m)}</code>`).join('')}</div>
          </div>` : ''}
        ${found ? renderOverwritePrompt(key, s, defaultKeep, defaultApply) : ''}
      </div>
    `;
  }

  function renderOverwritePrompt(modKey, s, defaultKeep, defaultApply) {
    // Settings groups (defaultKeep) render with «خیر، حفظ کن» pre-selected:
    // the safe default is already decided, the user may still opt in to
    // overwriting. Profile groups (defaultApply) render with «بله، اعمال کن»
    // pre-selected and apply wording. CSP/Pure keep the original
    // undecided behaviour.
    if (defaultApply) {
      return `
      <div class="overwrite-box">
        <div class="text-dim">${s('applyQuestion')}</div>
        <div class="overwrite-actions">
          <button class="btn-secondary overwrite-btn selected" data-mod="${modKey}" data-choice="yes">${s('applyYes')}</button>
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="no">${s('applyNo')}</button>
        </div>
      </div>
    `;
    }
    return `
      <div class="overwrite-box">
        <div class="text-dim">${s('overwriteQuestion')}</div>
        <div class="overwrite-actions">
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="yes">${s('yes')}</button>
          <button class="btn-secondary overwrite-btn ${defaultKeep ? 'selected' : ''}" data-mod="${modKey}" data-choice="no">${s('no')}</button>
        </div>
      </div>
    `;
  }

  function renderSummary(result, s) {
    const foundCount = (result.csp.found ? 1 : 0) + (result.pure.found ? 1 : 0)
      + (result.video && result.video.found ? 1 : 0)
      + (result.cspsettings && result.cspsettings.found ? 1 : 0);
    return `
      <div class="basecheck-summary">
        ${window.ui.statCard('', s('summaryTitle'), s('summaryValue').replace('{n}', foundCount), foundCount ? 'accent' : '')}
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
