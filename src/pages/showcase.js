(function () {
  const SLIDE_COUNT = 9;
  let slideInterval = null;
  let current = 0;
  let running = false;

  const MOD_INFO = [
    {
      id: 'csp',
      icon: '🌓',
      nameKey: 'modCsp',
      descKey: 'modCspDesc',
      requires: '',
      paths: ['extension/config/data_manifest.ini', 'extension/dwrite.ini', 'dwrite.dll  (کنار acs.exe)']
    },
    {
      id: 'pure',
      icon: '✨',
      nameKey: 'modPure',
      descKey: 'modPureDesc',
      requires: 'CSP · Weather FX',
      paths: ['extension/config-ext/Pure', 'extension/config-ext/pure/']
    },
    {
      id: 'ppfilter',
      icon: '🎨',
      nameKey: 'modPp',
      descKey: 'modPpDesc',
      requires: '',
      paths: ['system/cfg/ppfilters/*.ini']
    },
    {
      id: 'chasecam',
      icon: '📷',
      nameKey: 'modChase',
      descKey: 'modChaseDesc',
      requires: '',
      paths: ['system/cfg/camera.ini', 'system/cfg/cams.ini', 'content/cars/*/cams.ini']
    },
    {
      id: 'hud',
      icon: '🖥',
      nameKey: 'modHud',
      descKey: 'modHudDesc',
      requires: '',
      paths: ['apps/', 'content/apps/', 'extension/apps/']
    },
    {
      id: 'srp',
      icon: '💡',
      nameKey: 'modSrp',
      descKey: 'modSrpDesc',
      requires: 'PURE',
      paths: ['extension/config-ext/pure/']
    },
    {
      id: 'video',
      icon: '⚙️',
      nameKey: 'modVideo',
      descKey: 'modVideoDesc',
      requires: '',
      paths: ['system/cfg/video.ini']
    }
  ];

  const TIER_MODS = window.TIER_MODS;

  function clean() {
    if (slideInterval) {
      clearInterval(slideInterval);
      slideInterval = null;
    }
    running = false;
  }

  function render(container) {
    clean();

    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const s = (k) => window.i18n.t(lang, 'showcase.' + k);
    const settings = window.appState.settings || {};
    const manifest = window.appState.manifest;
    const hasAnyInstalledMod = manifest && manifest.mods &&
      Object.values(manifest.mods).some((arr) =>
        Array.isArray(arr) && arr.some((e) => e.status === 'installed' || ((e.files || []).length > 0))
      );

    container.innerHTML = `
      <div class="home">
        <!-- ================= HERO (slideshow on top) ================= -->
        <section class="home-hero">
          <div class="home-hero-top">
            <div class="home-brand">
              <img src="assets/images/logo.jpg" alt="UHM" />
              <div>
                <div class="home-brand-title">${s('title')}</div>
                <div class="home-brand-tagline">${s('tagline')}</div>
              </div>
            </div>

            <button class="home-settings-btn" id="btn-settings-home" title="${s('settings')}">
              <span class="home-icon">⚙️</span>
              <span>${s('settings')}</span>
            </button>
          </div>

          <div class="home-slider" id="home-slider">
            ${Array.from({ length: SLIDE_COUNT }).map((_, i) => `
              <div class="home-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                <img class="home-slide-bg" src="assets/images/showcase/0${i + 1}.jpg" alt="" />
                <img class="home-slide-fg" src="assets/images/showcase/0${i + 1}.jpg" alt="UHM showcase ${i + 1}" />
              </div>
            `).join('')}
            <div class="home-slider-overlay">
              <div class="home-slider-badge"><span class="badge-dot"></span>${s('subtitle')}</div>
              <div class="home-slider-title">${s('title')}</div>
              <div class="home-slider-sub">${s('heroSub')}</div>
            </div>
            <div class="home-slider-brand">UHM PACK</div>
          </div>

          <div class="home-dots" id="home-dots">
            ${Array.from({ length: SLIDE_COUNT }).map((_, i) => `
              <span class="home-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
            `).join('')}
          </div>
        </section>

        <!-- ================= SYSTEM STATUS / NEXT STEPS ================= -->
        <section class="home-section" id="home-status-section">
          <div class="home-status">
            <div class="home-status-grid">
              <div class="home-status-card" id="home-status-system">
                <div class="home-status-label">${s('systemStatus')}</div>
                <div class="home-status-value">${s('detecting')}</div>
              </div>
              <div class="home-status-card" id="home-status-game">
                <div class="home-status-label">${s('gameStatus')}</div>
                <div class="home-status-value">${settings.gamePath ? uhmEsc(settings.gamePath) : s('noPath')}</div>
              </div>
              <div class="home-status-card" id="home-status-mods">
                <div class="home-status-label">${s('modsStatus')}</div>
                <div class="home-status-value">${hasAnyInstalledMod ? s('modsInstalled') : s('modsNone')}</div>
              </div>
            </div>
            ${!settings.gamePath ? `
              <div class="home-next">
                <div class="home-next-text">${s('nextHint')}</div>
                <button class="btn-secondary" id="btn-next-path">${s('nextAction')}</button>
              </div>` : ''}
          </div>
        </section>

        <!-- ================= GRAPHIC PRESETS ================= -->
        <section class="home-section" id="home-presets">
          <div class="home-section-head">
            <div class="home-section-kicker">${s('tiersTitle')}</div>
            <div class="home-section-title">${s('tiersTitle')}</div>
            <div class="home-section-sub">${s('tiersSubtitle')}</div>
          </div>

          <div class="home-tiers">
            ${window.TIER_DEFINITIONS.map((tier) => renderTierCard(tier, s, t)).join('')}
          </div>
        </section>

        <!-- ================= MODS IN PACK ================= -->
        <section class="home-section" id="home-mods">
          <div class="home-section-head">
            <div class="home-section-kicker">${s('modsTitle')}</div>
            <div class="home-section-title">${s('modsTitle')}</div>
            <div class="home-section-sub">${s('modsSubtitle')}</div>
          </div>

          <div class="home-mods">
            ${MOD_INFO.map((mod) => renderModCard(mod, s)).join('')}
          </div>
        </section>

        <!-- ================= GAME FILE REFERENCES ================= -->
        <section class="home-section" id="home-refs">
          <div class="home-section-head">
            <div class="home-section-kicker">${s('refTitle')}</div>
            <div class="home-section-title">${s('refTitle')}</div>
            <div class="home-section-sub">${s('refSubtitle')}</div>
          </div>
          <div class="home-refs compass">
            <div class="home-ref"><code>acs.exe</code><span>${s('refRoot')}</span></div>
            <div class="home-ref"><code>content/cars</code><span>cars</span></div>
            <div class="home-ref"><code>content/tracks</code><span>tracks</span></div>
            <div class="home-ref"><code>extension/config</code><span>CSP</span></div>
            <div class="home-ref"><code>extension/config-ext/Pure</code><span>PURE</span></div>
            <div class="home-ref"><code>system/cfg/ppfilters</code><span>PP</span></div>
            <div class="home-ref"><code>system/cfg/video.ini</code><span>video</span></div>
            <div class="home-ref"><code>apps/</code><span>HUD</span></div>
          </div>
        </section>

        <!-- ================= BOTTOM ACTIONS ================= -->
        <div class="home-footer">
          <div class="home-footer-scroll">${s('scrollHint')}</div>
          <div class="home-actions">
            <button class="btn-primary btn-lg home-action-main" id="btn-start-install">
              <span class="btn-icon">🚀</span>
              <span><strong>${s('startInstall')}</strong></span>
            </button>
            <button class="btn-secondary home-action" id="btn-library">${s('libraryBtn')}</button>
            <button class="btn-secondary home-action" id="btn-about">${s('about')}</button>
            ${hasAnyInstalledMod ? `<button class="btn-secondary home-action" id="btn-manage-mods">${s('manageShort')}</button>` : ''}
          </div>
        </div>
      </div>
    `;

    setupSlider(container);
    loadSystemStatus(container);

    document.getElementById('btn-start-install').addEventListener('click', () => navigate('gamePath'));
    document.getElementById('btn-about').addEventListener('click', () => navigate('about'));
    document.getElementById('btn-library').addEventListener('click', () => navigate('library'));
    document.getElementById('btn-settings-home').addEventListener('click', () => navigate('settings'));

    const manageBtn = document.getElementById('btn-manage-mods');
    if (manageBtn) manageBtn.addEventListener('click', () => navigate('manageMods'));
    const nextPath = document.getElementById('btn-next-path');
    if (nextPath) nextPath.addEventListener('click', () => navigate('gamePath'));
  }

  async function loadSystemStatus(container) {
    const lang = window.appState.lang;
    const s = (k) => window.i18n.t(lang, 'showcase.' + k);
    const systemEl = document.getElementById('home-status-system');
    try {
      const specs = await window.uhm.detectSystemSpecs();
      if (!systemEl) return;
      const tierLabel = specs.suggestedTier ? window.i18n.t(lang, 'tierSelect.' + specs.suggestedTier) : s('unknown');
      systemEl.innerHTML = `
        <div class="home-status-label">${s('systemStatus')}</div>
        <div class="home-status-value">${uhmEsc(specs.gpuName || s('unknown'))}</div>
        <div class="home-status-tag">${tierLabel}</div>`;
    } catch (e) {
      if (systemEl) systemEl.innerHTML = `<div class="home-status-label">${s('systemStatus')}</div><div class="home-status-value">${s('unknown')}</div>`;
    }
  }

  function renderTierCard(tier, s, t) {
    const label = window.i18n.t(window.appState.lang, 'tierSelect.' + tier.id);
    const bestFor = s('tierBest' + tier.id.charAt(0).toUpperCase() + tier.id.slice(1));
    const mods = (TIER_MODS[tier.id] || []).map((id) => {
      const mod = MOD_INFO.find((m) => m.id === id);
      return `<span class="home-chip">${mod.icon} ${s(mod.nameKey).replace(/\s*\(.*?\)/g, '')}</span>`;
    }).join('');

    return `
      <div class="home-tier-card">
        <img class="home-tier-img" src="${tier.image}" alt="${label}" />
        <div class="home-tier-badge">${tier.icon} ${label}</div>
        <div class="home-tier-best">
          <span class="home-kicker">${s('tierBestFor')}</span>
          <span class="home-tier-best-text">${bestFor}</span>
        </div>
        <div class="home-tier-mods">
          <span class="home-kicker">${s('tierFiles')}</span>
          <div class="home-chips">${mods}</div>
        </div>
      </div>
    `;
  }

  function renderModCard(mod, s) {
    const name = s(mod.nameKey);
    const desc = s(mod.descKey);
    const paths = mod.paths.map((p) => `<code>${uhmEsc(p)}</code>`).join('');
    const requires = mod.requires
      ? `<div class="home-mod-requires"><span class="home-kicker">${s('modRequires')}:</span> ${uhmEsc(mod.requires)}</div>`
      : '';

    return `
      <div class="home-mod-card">
        <div class="home-mod-icon">${mod.icon}</div>
        <div class="home-mod-body">
          <div class="home-mod-name">${name}</div>
          <div class="home-mod-desc">${desc}</div>
          ${requires}
          <div class="home-mod-paths">
            <span class="home-kicker">${s('modPath')}:</span>
            <div class="home-mod-path-list">${paths}</div>
          </div>
        </div>
        <div class="home-mod-status">${mod.icon}</div>
      </div>
    `;
  }

  function setupSlider(container) {
    const slides = container.querySelectorAll('.home-slide');
    const dots = container.querySelectorAll('.home-dot');
    current = 0;

    function goTo(index, instant = false) {
      slides[current].classList.remove('active');
      dots[current].classList.remove('active');
      current = index;
      if (instant) {
        slides[current].classList.add('active');
        dots[current].classList.add('active');
        return;
      }
      requestAnimationFrame(() => {
        slides[current].classList.add('active');
        dots[current].classList.add('active');
      });
    }

    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        clean();
        goTo(parseInt(dot.dataset.index, 10));
        startAutoSlide();
      });
    });

    function startAutoSlide() {
      if (running) return;
      running = true;
      slideInterval = setInterval(() => goTo((current + 1) % SLIDE_COUNT), 4500);
    }

    startAutoSlide();
  }

  function destroy() {
    clean();
  }

  window.pages.showcase = { render, destroy };
})();
