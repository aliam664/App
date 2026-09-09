(function () {
  const SLIDE_COUNT = 9;
  let slideInterval = null;
  let current = 0;
  let running = false;

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
    const manifest = window.appState.manifest;
    const hasAnyInstalledMod = manifest && manifest.mods &&
      Object.values(manifest.mods).some((m) => m.status === 'installed' || (Array.isArray(m) && m.length > 0));

    container.innerHTML = `
      <div class="showcase">
        <div class="showcase-badge" id="showcase-badge">
          <span class="badge-dot"></span>
          <span id="showcase-badge-text">${t('showcase.subtitle')}</span>
        </div>

        <div class="showcase-slider" id="showcase-slider">
          ${Array.from({ length: SLIDE_COUNT }).map((_, i) => `
            <div class="slide ${i === 0 ? 'active' : ''}" data-index="${i}">
              <img class="slide-bg" src="assets/images/showcase/0${i + 1}.jpg" alt="" />
              <img class="slide-fg" src="assets/images/showcase/0${i + 1}.jpg" alt="UHM showcase ${i + 1}" />
            </div>
          `).join('')}
          <div class="slide-brand">UHM PACK</div>
        </div>

        <div class="slide-dots" id="slide-dots">
          ${Array.from({ length: SLIDE_COUNT }).map((_, i) => `
            <span class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
          `).join('')}
        </div>

        <div class="showcase-actions">
          <button class="btn-primary btn-lg" id="btn-start-install">
            <span class="btn-icon">🚀</span>
            <span><strong>${t('showcase.startInstall')}</strong></span>
          </button>
          ${hasAnyInstalledMod ? `<button class="btn-secondary" id="btn-manage-mods">
            <span class="btn-icon">🗂</span><span>${t('showcase.manageMode')}</span>
          </button>` : ''}
        </div>
      </div>
    `;

    setupSlider(container);

    document.getElementById('btn-start-install').addEventListener('click', () => {
      navigate('gamePath');
    });

    const manageBtn = document.getElementById('btn-manage-mods');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => navigate('manageMods'));
    }
  }

  function setupSlider(container) {
    const slides = container.querySelectorAll('.slide');
    const dots = container.querySelectorAll('.dot');
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
      slideInterval = setInterval(() => {
        const next = (current + 1) % SLIDE_COUNT;
        goTo(next);
      }, 4500);
    }

    startAutoSlide();
  }

  function destroy() {
    clean();
  }

  window.pages.showcase = { render, destroy };
})();
