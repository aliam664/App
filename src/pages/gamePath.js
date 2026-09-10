/* ================================================================= */
/*  Game path — auto detect, browse, paste, live validation          */
/* ================================================================= */

(function () {
  let selectedPath = null;
  let validation = null;
  let busy = false;
  let validationSeq = 0;

  function t(key) { return window.i18n.t(window.appState.lang, key); }
  function s(key) { return window.i18n.t(window.appState.lang, 'gamePath.' + key); }

  function debounce(fn, ms) {
    let id = null;
    return function inner() {
      const args = arguments;
      clearTimeout(id);
      id = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function render(container) {
    const lang = window.appState.lang;
    selectedPath = window.appState.settings.gamePath || null;
    validation = null;
    busy = false;
    validationSeq = 0;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <div class="page-header-copy">
          <div class="gamepath-step">${t('common.step1')}</div>
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="gamepath-wrap page-stack">
        ${renderSourceCard()}
        ${renderPathCard()}
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    wire(container);
    if (selectedPath) validateAndRender(container);
  }

  function renderSourceCard() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🧭', kicker: 'Locate', title: s('locateTitle'), subtitle: s('locateSub') })}
        <div class="grid-2">
          <button class="card-sec gamepath-action" id="btn-browse">
            <div class="gamepath-action-icon">📂</div>
            <div>
              <div class="card-sec-title">${s('browse')}</div>
              <div class="card-sec-sub">${s('browseSub')}</div>
            </div>
          </button>
          <button class="card-sec gamepath-action" id="btn-auto-detect">
            <div class="gamepath-action-icon">🔍</div>
            <div>
              <div class="card-sec-title">${s('autoDetect')}</div>
              <div class="card-sec-sub">${s('autoSub')}</div>
            </div>
          </button>
        </div>
      </section>
    `;
  }

  function renderPathCard() {
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '📁', kicker: 'Path', title: s('pathTitle'), subtitle: s('pathSub') })}
        <div class="card-sec">
          <label class="field-label">${s('pasteLabel')}</label>
          <input class="gamepath-input" id="path-input" type="text" dir="ltr" spellcheck="false"
                 placeholder="${s('placeholder')}" value="${selectedPath ? uhmEsc(selectedPath) : ''}" />
          <div class="gamepath-status" id="path-status"></div>
          <div class="validation-grid" id="validation-grid"></div>
          <div class="text-dim gamepath-tip">${s('tip')}</div>
        </div>
      </section>
    `;
  }

  function wire(container) {
    container.querySelector('.gamepath-action#btn-browse').addEventListener('click', async () => {
      const picked = await window.uhm.browseGamePath();
      if (picked) {
        setPath(container, picked);
      }
    });

    document.getElementById('btn-auto-detect').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const statusEl = document.getElementById('path-status');
      statusEl.textContent = s('searching');
      statusEl.className = 'gamepath-status searching';
      const found = await window.uhm.autoDetectGamePath();
      if (found) {
        setPath(container, found);
      } else {
        statusEl.textContent = s('notFound');
        statusEl.className = 'gamepath-status invalid';
      }
      busy = false;
    });

    // Validate on a short debounce so we do not fire an IPC round-trip on every
    // keystroke while the user types/pastes a path.
    document.getElementById('path-input').addEventListener('input', debounce((e) => {
      const value = e.target.value.trim();
      if (!value) { clearValidation(); return; }
      selectedPath = value;
      validateAndRender(container);
    }, 250));

    document.getElementById('btn-continue').addEventListener('click', async () => {
      if (!isValidNow()) return;
      await window.uhm.setSettings({ gamePath: selectedPath });
      window.appState.settings.gamePath = selectedPath;
      navigate('baseModsCheck');
    });
  }

  async function setPath(container, value, forceValidation = true) {
    selectedPath = value;
    const input = document.getElementById('path-input');
    if (input) input.value = value;
    if (forceValidation) await validateAndRender(container);
  }

  function clearValidation() {
    validation = null;
    const statusEl = document.getElementById('path-status');
    const continueBtn = document.getElementById('btn-continue');
    const grid = document.getElementById('validation-grid');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'gamepath-status'; }
    if (continueBtn) continueBtn.disabled = true;
    if (grid) grid.innerHTML = '';
  }

  async function validateAndRender(container) {
    if (!selectedPath) return;
    // Monotonic sequence so a slow, older validation response can never
    // overwrite a newer one when the user types/pastes quickly.
    const seq = ++validationSeq;
    const statusEl = document.getElementById('path-status');
    const continueBtn = document.getElementById('btn-continue');
    const grid = document.getElementById('validation-grid');
    statusEl.textContent = s('searching');
    statusEl.className = 'gamepath-status searching';

    const result = await window.uhm.validateGamePath(selectedPath);
    if (seq !== validationSeq) return; // stale — a newer validation supersedes this one
    validation = result;
    statusEl.textContent = result.valid ? s('validOk') : (result.reason === 'NO_CONTENT_DIR' ? s('invalidNoContent') : s('invalidNoExe'));
    statusEl.className = 'gamepath-status ' + (result.valid ? 'valid' : 'invalid');
    continueBtn.disabled = !result.valid;

    if (grid) {
      grid.innerHTML = `${checkRow(s('exeOk'), s('exeMissing'), result.reason !== 'NO_ACS_EXE')}${checkRow(s('contentOk'), s('contentMissing'), result.reason !== 'NO_CONTENT_DIR')}`;
    }
  }

  function checkRow(okLabel, missingLabel, ok) {
    return `
      <div class="validation-row ${ok ? 'ok' : 'bad'}">
        <span>${ok ? '✅' : '❌'}</span>
        <span>${ok ? okLabel : missingLabel}</span>
      </div>`;
  }

  function isValidNow() {
    return Boolean(validation && validation.valid);
  }

  window.pages.gamePath = { render };
})();
