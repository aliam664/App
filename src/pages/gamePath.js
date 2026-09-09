(function () {
  let selectedPath = null;
  let isValid = false;
  let busy = false;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'gamePath.' + k);

    selectedPath = window.appState.settings.gamePath || null;
    isValid = false;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang)}</button>
        <h2>${s('title')}</h2>
      </div>

      <div class="gamepath-wrap">
        <div class="gamepath-step">${lang === 'fa' ? 'مرحله ۱ از ۵' : 'Step 1 of 5'}</div>
        <div class="gamepath-icon">📁</div>

        <button class="btn-secondary" id="btn-auto-detect">${s('autoDetect')}</button>

        <div class="gamepath-input-row">
          <div class="gamepath-input" id="path-display">${selectedPath ? uhmEsc(selectedPath) : s('placeholder')}</div>
          <button class="btn-secondary" id="btn-browse">${s('browse')}</button>
        </div>

        <div class="gamepath-status" id="path-status"></div>
        <div class="text-dim gamepath-tip">${s('tip')}</div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>
          <span>${s('continueBtn')}</span><span class="btn-arrow">${lang === 'fa' ? '⬅' : '➡'}</span>
        </button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));

    document.getElementById('btn-browse').addEventListener('click', async () => {
      const picked = await window.uhm.browseGamePath();
      if (picked) {
        selectedPath = picked;
        await validateAndRender(container);
      }
    });

    document.getElementById('btn-auto-detect').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      const statusEl = document.getElementById('path-status');
      statusEl.textContent = s('searching');
      statusEl.className = 'gamepath-status searching';
      const btn = document.getElementById('btn-auto-detect');
      btn.disabled = true;

      const found = await window.uhm.autoDetectGamePath();
      if (found) {
        selectedPath = found;
        await validateAndRender(container);
      } else {
        statusEl.textContent = s('notFound');
        statusEl.className = 'gamepath-status invalid';
      }
      btn.disabled = false;
      busy = false;
    });

    document.getElementById('btn-continue').addEventListener('click', async () => {
      if (!isValid) return;
      await window.uhm.setSettings({ gamePath: selectedPath });
      window.appState.settings.gamePath = selectedPath;
      navigate('baseModsCheck');
    });

    if (selectedPath) validateAndRender(container);
  }

  async function validateAndRender(container) {
    if (!selectedPath) return;
    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'gamePath.' + k);
    document.getElementById('path-display').textContent = selectedPath;

    const statusEl = document.getElementById('path-status');
    const continueBtn = document.getElementById('btn-continue');
    statusEl.textContent = s('searching');
    statusEl.className = 'gamepath-status searching';

    const result = await window.uhm.validateGamePath(selectedPath);

    if (result.valid) {
      isValid = true;
      statusEl.textContent = s('validOk');
      statusEl.className = 'gamepath-status valid';
      continueBtn.disabled = false;
    } else {
      isValid = false;
      statusEl.textContent = result.reason === 'NO_CONTENT_DIR' ? s('invalidNoContent') : s('invalidNoExe');
      statusEl.className = 'gamepath-status invalid';
      continueBtn.disabled = true;
    }
  }

  window.pages.gamePath = { render };
})();
