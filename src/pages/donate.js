/* ================================================================= */
/*  Donate — card-to-card donation with copy-to-clipboard            */
/*                                                                    */
/*  A self-contained page: animated hero, a bank-card visual with    */
/*  the card number grouped for readability, a one-tap copy button   */
/*  (with ripple + success morph), a 3-step "how to donate" guide    */
/*  and a thank-you footer. The card number is defined in ONE place  */
/*  below so it is trivial to change.                                */
/* ================================================================= */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Card configuration (single source of truth)                        */
  /* ------------------------------------------------------------------ */

  // The donation card number. Displayed in groups of 4, copied raw.
  const CARD_NUMBER = '5859831837795714';

  // Optional account holder label. Leave empty to show the generic
  // "UHM bank account" placeholder instead of a specific name.
  const CARD_HOLDER = '';

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let copiedTimer = null;

  /* ------------------------------------------------------------------ */
  /*  i18n helpers                                                       */
  /* ------------------------------------------------------------------ */

  function lang() { return window.appState.lang; }
  function t(key) { return window.i18n.t(lang(), key); }
  function s(key) { return window.i18n.t(lang(), 'donate.' + key); }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function digitGroups(num) {
    const digits = String(num || '').replace(/\D/g, '');
    const groups = [];
    for (let i = 0; i < digits.length; i += 4) groups.push(digits.slice(i, i + 4));
    return groups;
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  function render(container) {
    const l = lang();
    const groups = digitGroups(CARD_NUMBER);
    const formatted = groups.join(' ');

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(l)}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>

      <div class="donate-wrap">
        ${renderHero()}
        ${renderCard(groups)}
        ${renderSteps()}
        ${renderThanks()}
        <div class="text-dim donate-note">${s('supportNote')}</div>
      </div>
    `;

    wire(container);
  }

  /* ---------------- hero (with floating hearts) ---------------- */

  function renderHero() {
    const hearts = [];
    const HEART_SET = ['❤️', '💙', '💜', '💗', '💛', '🤍'];
    const HEART_COUNT = 16;
    for (let i = 0; i < HEART_COUNT; i += 1) {
      const left = Math.round(2 + Math.random() * 94);
      const size = 13 + Math.round(Math.random() * 26);
      const delay = (Math.random() * 6).toFixed(2);
      const duration = (7 + Math.random() * 8).toFixed(2);
      const peakOpacity = (0.14 + Math.random() * 0.34).toFixed(2);
      const drift = (Math.random() * 60 - 30).toFixed(0);
      hearts.push(
        `<span class="donate-heart" aria-hidden="true" style="left:${left}%;font-size:${size}px;` +
        `animation-delay:${delay}s;animation-duration:${duration}s;--ho:${peakOpacity};--dx:${drift}px;">` +
        `${HEART_SET[i % HEART_SET.length]}</span>`
      );
    }

    return `
      <section class="donate-hero">
        <div class="donate-hearts">${hearts.join('')}</div>
        <div class="donate-hero-icon" aria-hidden="true">💝</div>
        <div class="donate-hero-kicker">${s('kicker')}</div>
        <h1 class="donate-hero-title">${s('heroTitle')}</h1>
        <div class="text-dim donate-hero-sub">${s('heroSub')}</div>
      </section>`;
  }

  /* ---------------- the bank card ---------------- */

  function renderCard(groups) {
    const numberHtml = groups
      .map((g, i) => `<span class="donate-card-group" style="--i:${i}">${g}</span>`)
      .join('');
    const holder = CARD_HOLDER ? uhmEsc(CARD_HOLDER) : s('cardHolderPlaceholder');

    return `
      <section class="donate-card-section">
        <div class="donate-card-glow" aria-hidden="true"></div>

        <div class="donate-card" dir="ltr" role="img" aria-label="${s('cardTitle')}">
          <div class="donate-card-sheen" aria-hidden="true"></div>
          <div class="donate-card-top">
            <span class="donate-card-brand">${uhmEsc(t('appName'))}</span>
            <span class="donate-card-badge">${s('cardToCard')}</span>
          </div>
          <div class="donate-card-chip" aria-hidden="true"></div>
          <div class="donate-card-contactless" aria-hidden="true"></div>
          <div class="donate-card-number">${numberHtml}</div>
          <div class="donate-card-bottom">
            <div class="donate-card-holder">
              <span class="donate-card-label">${s('cardHolder')}</span>
              <span class="donate-card-holder-name">${holder}</span>
            </div>
            <div class="donate-card-emblem" aria-hidden="true">💳</div>
          </div>
        </div>

        <div class="text-dim donate-card-caption">${s('cardSub')}</div>

        <button class="donate-copy-btn" id="btn-copy-card" type="button">
          <span class="donate-copy-icon" aria-hidden="true">📋</span>
          <span class="donate-copy-label">${s('copyCard')}</span>
        </button>
      </section>`;
  }

  /* ---------------- how-to steps ---------------- */

  function renderSteps() {
    const steps = [
      { n: '1', icon: '📋', title: s('how1Title'), desc: s('how1Desc') },
      { n: '2', icon: '🏦', title: s('how2Title'), desc: s('how2Desc') },
      { n: '3', icon: '💸', title: s('how3Title'), desc: s('how3Desc') }
    ];
    return `
      <section class="ui-section">
        ${window.ui.sectionHeader({ icon: '🪙', kicker: s('howKicker'), title: s('howTitle'), subtitle: s('howSub') })}
        <div class="donate-steps">
          ${steps.map((st) => `
            <div class="donate-step">
              <div class="donate-step-num">${st.n}</div>
              <div class="donate-step-icon" aria-hidden="true">${st.icon}</div>
              <div class="donate-step-title">${st.title}</div>
              <div class="text-dim">${st.desc}</div>
            </div>`).join('')}
        </div>
      </section>`;
  }

  /* ---------------- thank-you footer ---------------- */

  function renderThanks() {
    return `
      <section class="donate-thanks">
        <div class="donate-thanks-icon" aria-hidden="true">💙</div>
        <div class="donate-thanks-title">${s('thankYou')}</div>
        <div class="text-dim">${s('thankYouSub')}</div>
        <button class="btn-secondary" id="btn-donate-home">${s('backHome')}</button>
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Wiring                                                             */
  /* ------------------------------------------------------------------ */

  function wire(container) {
    document.getElementById('btn-back').addEventListener('click', () => goBack('showcase'));
    document.getElementById('btn-copy-card').addEventListener('click', (e) => copyCardNumber(e.currentTarget));

    const homeBtn = document.getElementById('btn-donate-home');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        window.appState.navStack = [];
        navigate('showcase', {}, { replace: true });
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Copy to clipboard (Electron IPC → Clipboard API → legacy)          */
  /* ------------------------------------------------------------------ */

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function copyCardNumber(btn) {
    let ok = false;
    try {
      if (window.uhm && typeof window.uhm.copyText === 'function') {
        ok = Boolean(await window.uhm.copyText(CARD_NUMBER));
      } else if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
        await window.navigator.clipboard.writeText(CARD_NUMBER);
        ok = true;
      } else {
        ok = legacyCopy(CARD_NUMBER);
      }
    } catch (e) {
      ok = legacyCopy(CARD_NUMBER);
    }

    if (ok) {
      showCopied(btn);
      uhmToast(s('copiedSub'), 'success', 2400);
    } else {
      uhmToast(t('toast.error'), 'error');
    }
  }

  function showCopied(btn) {
    if (!btn) return;
    spawnRipple(btn);
    btn.classList.add('copied');
    const icon = btn.querySelector('.donate-copy-icon');
    const label = btn.querySelector('.donate-copy-label');
    if (icon) icon.textContent = '✅';
    if (label) label.textContent = s('copied');
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      btn.classList.remove('copied');
      if (icon) icon.textContent = '📋';
      if (label) label.textContent = s('copyCard');
    }, 2400);
  }

  function spawnRipple(btn) {
    const ripple = document.createElement('span');
    ripple.className = 'donate-ripple';
    btn.appendChild(ripple);
    setTimeout(() => {
      if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 650);
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  function destroy() {
    if (copiedTimer) {
      clearTimeout(copiedTimer);
      copiedTimer = null;
    }
  }

  window.pages.donate = { render, destroy };
})();
