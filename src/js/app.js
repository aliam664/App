// وضعیت سراسری برنامه که همه‌ی صفحات بهش دسترسی دارن
window.appState = {
  lang: 'fa',
  theme: 'night',
  settings: null,
  manifest: null
};

const pageContainer = document.getElementById('page-content');

// ثبت صفحات - هر صفحه یه فایل جدا با تابع render(container) هست
window.pages = {};

function navigate(pageName, params) {
  const page = window.pages[pageName];
  if (!page) {
    console.error('صفحه پیدا نشد:', pageName);
    pageContainer.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back-fallback">${window.appState.lang === 'fa' ? '←' : '→'}</button>
        <h2>${window.appState.lang === 'fa' ? 'به‌زودی' : 'Coming soon'}</h2>
      </div>
      <div class="text-dim">
        ${window.appState.lang === 'fa'
          ? 'این بخش هنوز ساخته نشده (صفحه: ' + pageName + ')'
          : 'This page is not built yet (' + pageName + ')'}
      </div>
    `;
    document.getElementById('btn-back-fallback').addEventListener('click', () => navigate('showcase'));
    return;
  }
  pageContainer.innerHTML = '';
  page.render(pageContainer, params || {});
}
window.navigate = navigate;

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  window.appState.theme = theme;
}

function applyLanguage(lang) {
  const dir = window.i18n.t(lang, 'dir');
  document.body.setAttribute('dir', dir);
  window.appState.lang = lang;
  document.getElementById('app-name-label').textContent = window.i18n.t(lang, 'appName');
}

function wireTitlebar() {
  document.getElementById('btn-minimize').addEventListener('click', () => window.uhm.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.uhm.windowToggleMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.uhm.windowClose());

  document.getElementById('btn-theme-toggle').addEventListener('click', async () => {
    const newTheme = window.appState.theme === 'night' ? 'day' : 'night';
    applyTheme(newTheme);
    await window.uhm.setSettings({ theme: newTheme });
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    navigate('settings');
  });
}

async function bootstrap() {
  const settings = await window.uhm.getSettings();
  const manifest = await window.uhm.getManifest();
  window.appState.settings = settings;
  window.appState.manifest = manifest;

  applyTheme(settings.theme || 'night');
  applyLanguage(settings.language || 'fa');

  wireTitlebar();
  navigate('showcase');
}

document.addEventListener('DOMContentLoaded', bootstrap);
