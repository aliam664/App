(function () {
  const TEXT = {
    fa: {
      title: 'بررسی فایل‌های پایه بازی',
      checking: 'در حال بررسی مسیر بازی...',
      cspFound: '✅ Custom Shaders Patch (CSP) — نصب شده است',
      cspNotFound: '⬜ Custom Shaders Patch (CSP) — نصب نیست',
      pureFound: '✅ PURE — نصب شده است',
      pureNotFound: '⬜ PURE — نصب نیست',
      overwriteQuestion: 'نسخه‌ای از این قبلاً نصب شده. آیا با نسخه‌ی UHM بازنویسی شود؟',
      yes: 'بله',
      no: 'خیر',
      continueBtn: 'ادامه'
    },
    en: {
      title: 'Checking base game files',
      checking: 'Checking game path...',
      cspFound: '✅ Custom Shaders Patch (CSP) — Installed',
      cspNotFound: '⬜ Custom Shaders Patch (CSP) — Not installed',
      pureFound: '✅ PURE — Installed',
      pureNotFound: '⬜ PURE — Not installed',
      overwriteQuestion: 'A version of this is already installed. Overwrite with the UHM version?',
      yes: 'Yes',
      no: 'No',
      continueBtn: 'Continue'
    }
  };

  // تصمیم کاربر درباره‌ی بازنویسی هرکدوم - در appState نگه داشته میشه
  // تا صفحه‌ی نصب خودکار بعدا بتونه ازش استفاده کنه
  function render(container) {
    const lang = window.appState.lang;
    const s = TEXT[lang] || TEXT.fa;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${lang === 'fa' ? '←' : '→'}</button>
        <h2>${s.title}</h2>
      </div>

      <div class="basecheck-wrap" id="basecheck-wrap">
        <div class="text-dim">${s.checking}</div>
      </div>

      <div class="wizard-footer">
        <button class="btn-primary" id="btn-continue" disabled>${s.continueBtn}</button>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', () => window.navigate('gamePath'));
    document.getElementById('btn-continue').addEventListener('click', () => {
      window.navigate('tierSelect');
    });

    runCheck(container, s);
  }

  async function runCheck(container, s) {
    const gamePath = window.appState.settings.gamePath;
    const result = await window.uhm.checkBaseMods(gamePath);

    // تصمیم پیش‌فرض: اگر چیزی پیدا نشد، نیازی به سوال نیست، مستقیم نصب "تازه" حساب میشه
    window.appState.overwriteDecisions = {
      csp: !result.csp.found,
      pure: !result.pure.found
    };

    const wrap = document.getElementById('basecheck-wrap');
    wrap.innerHTML = `
      <div class="card basecheck-row">
        <div>${result.csp.found ? s.cspFound : s.cspNotFound}</div>
        ${result.csp.found ? renderOverwritePrompt('csp', s) : ''}
      </div>
      <div class="card basecheck-row">
        <div>${result.pure.found ? s.pureFound : s.pureNotFound}</div>
        ${result.pure.found ? renderOverwritePrompt('pure', s) : ''}
      </div>
    `;

    wireOverwriteButtons(container, s, result);
    updateContinueState(container, result);
  }

  function renderOverwritePrompt(modKey, s) {
    return `
      <div class="overwrite-box">
        <div class="text-dim">${s.overwriteQuestion}</div>
        <div class="overwrite-actions">
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="yes">${s.yes}</button>
          <button class="btn-secondary overwrite-btn" data-mod="${modKey}" data-choice="no">${s.no}</button>
        </div>
      </div>
    `;
  }

  function wireOverwriteButtons(container, s, result) {
    container.querySelectorAll('.overwrite-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modKey = btn.dataset.mod;
        const choice = btn.dataset.choice === 'yes';
        window.appState.overwriteDecisions[modKey] = choice;

        // هایلایت گزینه‌ی انتخاب‌شده
        const siblingBtns = btn.parentElement.querySelectorAll('.overwrite-btn');
        siblingBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');

        updateContinueState(container, result);
      });
    });
  }

  function updateContinueState(container, result) {
    // اگر مودی از قبل پیدا شده، کاربر باید حتما دکمه‌ی بله/خیر رو زده باشه
    const cspDecided = !result.csp.found || container.querySelector('.overwrite-btn[data-mod="csp"].selected');
    const pureDecided = !result.pure.found || container.querySelector('.overwrite-btn[data-mod="pure"].selected');

    document.getElementById('btn-continue').disabled = !(cspDecided && pureDecided);
  }

  window.pages.baseModsCheck = { render };
})();
