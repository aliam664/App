(function () {
  let selectedPath = null;
  let isValid = false;

  const TEXT = {
    fa: {
      title: 'مسیر نصب Assetto Corsa را مشخص کن',
      autoDetect: '🔍 جستجوی خودکار',
      browse: 'مرور...',
      placeholder: 'مسیری انتخاب نشده',
      validOk: '✅ مسیر معتبر است',
      invalidNoExe: '❌ فایل acs.exe در این مسیر پیدا نشد',
      invalidNoContent: '❌ پوشه content در این مسیر پیدا نشد',
      searching: 'در حال جستجو...',
      notFound: 'مسیر به‌صورت خودکار پیدا نشد. لطفاً دستی انتخاب کن.',
      continueBtn: 'ادامه'
    },
    en: {
      title: 'Select the Assetto Corsa install path',
      autoDetect: '🔍 Auto Detect',
      browse: 'Browse...',
      placeholder: 'No path selected',
      validOk: '✅ Valid path',
      invalidNoExe: '❌ acs.exe not found in this path',
      invalidNoContent: '❌ content folder not found in this path',
      searching: 'Searching...',
      notFound: 'Could not auto-detect the path. Please browse manually.',
      continueBtn: 'Continue'
    }
  };

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = TEXT[lang] || TEXT.fa;

    // اگر قبلا مسیری در تنظیمات ذخیره شده، پیش‌فرض بگیریم
    selectedPath = window.appState.settings.gamePath || null;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${lang === 'fa' ? '←' : '→'}</button>
        <h2>${s.title}</h2>
      </div>

      <div class="gamepath-wrap">
        <div class="gamepath-icon">📁</div>

        <button class="btn-secondary" id="btn-auto-detect">${s.autoDetect}</button>

        <div class="gamepath-input-row">
          <div class="gamepath-input" id="path-display">${selectedPath || s.placeholder}</div>
          <button class="btn-secondary" id="btn-browse">${s.browse}</button>
        </div>

        <div class="gamepath-status" id="path-status"></div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>${s.continueBtn}</button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => window.navigate('showcase'));

    document.getElementById('btn-browse').addEventListener('click', async () => {
      const picked = await window.uhm.browseGamePath();
      if (picked) {
        selectedPath = picked;
        await validateAndRender(container, s);
      }
    });

    document.getElementById('btn-auto-detect').addEventListener('click', async () => {
      const statusEl = document.getElementById('path-status');
      statusEl.textContent = s.searching;
      statusEl.className = 'gamepath-status searching';
      const found = await window.uhm.autoDetectGamePath();
      if (found) {
        selectedPath = found;
        await validateAndRender(container, s);
      } else {
        statusEl.textContent = s.notFound;
        statusEl.className = 'gamepath-status invalid';
      }
    });

    document.getElementById('btn-continue').addEventListener('click', async () => {
      if (!isValid) return;
      await window.uhm.setSettings({ gamePath: selectedPath });
      window.appState.settings.gamePath = selectedPath;
      window.navigate('baseModsCheck');
    });

    // اگر مسیر از قبل موجود بود، همون ابتدا اعتبارسنجی کن
    if (selectedPath) {
      validateAndRender(container, s);
    }
  }

  async function validateAndRender(container, s) {
    document.getElementById('path-display').textContent = selectedPath;
    const result = await window.uhm.validateGamePath(selectedPath);
    const statusEl = document.getElementById('path-status');
    const continueBtn = document.getElementById('btn-continue');

    if (result.valid) {
      isValid = true;
      statusEl.textContent = s.validOk;
      statusEl.className = 'gamepath-status valid';
      continueBtn.disabled = false;
    } else {
      isValid = false;
      statusEl.textContent = result.reason === 'NO_CONTENT_DIR' ? s.invalidNoContent : s.invalidNoExe;
      statusEl.className = 'gamepath-status invalid';
      continueBtn.disabled = true;
    }
  }

  window.pages.gamePath = { render };
})();
