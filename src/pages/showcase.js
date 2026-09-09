(function () {
  const SLIDE_COUNT = 9;
  let slideInterval = null;

  function render(container) {
    const lang = window.appState.lang;
    const t = (k) => window.i18n.t(lang, k);
    const manifest = window.appState.manifest;
    const hasAnyInstalledMod = manifest && manifest.mods &&
      Object.values(manifest.mods).some((m) => m.status === 'installed');

    container.innerHTML = `
      <div class="showcase">
        <div class="showcase-slider" id="showcase-slider">
          ${Array.from({ length: SLIDE_COUNT }).map((_, i) => `
            <div class="slide ${i === 0 ? 'active' : ''}" data-index="${i}">
              <img class="slide-bg" src="assets/images/showcase/0${i + 1}.jpg" />
              <img class="slide-fg" src="assets/images/showcase/0${i + 1}.jpg" />
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
          <button class="btn-primary" id="btn-start-install">${t('showcase.startInstall')}</button>
          ${hasAnyInstalledMod ? `<button class="btn-secondary" id="btn-manage-mods">${t('showcase.manageMode')}</button>` : ''}
        </div>
      </div>
    `;

    setupSlider(container);

    document.getElementById('btn-start-install').addEventListener('click', () => {
      window.navigate('gamePath');
    });

    const manageBtn = document.getElementById('btn-manage-mods');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => window.navigate('manageMods'));
    }
  }

  function setupSlider(container) {
    let current = 0;
    const slides = container.querySelectorAll('.slide');
    const dots = container.querySelectorAll('.dot');

    function goTo(index) {
      slides[current].classList.remove('active');
      dots[current].classList.remove('active');
      current = index;
      slides[current].classList.add('active');
      dots[current].classList.add('active');
    }

    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        clearInterval(slideInterval);
        goTo(parseInt(dot.dataset.index, 10));
        startAutoSlide();
      });
    });

    function startAutoSlide() {
      slideInterval = setInterval(() => {
        const next = (current + 1) % SLIDE_COUNT;
        goTo(next);
      }, 4000);
    }

    startAutoSlide();
  }

  window.pages.showcase = { render };
})();
