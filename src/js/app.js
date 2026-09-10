/* ------------------------------------------------------------------ */
/*  Global state                                                       */
/* ------------------------------------------------------------------ */
window.appState = {
  lang: 'fa',
  theme: 'night',
  settings: null,
  manifest: null,
  navStack: [],
  currentPage: null,
  installPlan: null,
  overwriteDecisions: null,
  lastInstallResult: null
};

const pageContainer = document.getElementById('page-content');
window.pages = {};

/* ------------------------------------------------------------------ */
/*  Theme / language                                                   */
/* ------------------------------------------------------------------ */
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme || 'night');
  window.appState.theme = theme || 'night';
}

function applyLanguage(lang) {
  const dir = window.i18n.t(lang, 'dir');
  document.body.setAttribute('dir', dir);
  window.appState.lang = lang || 'fa';
  const label = document.getElementById('app-name-label');
  if (label) label.textContent = window.i18n.t(lang, 'appName');
}

function destroyCurrentPage() {
  const page = window.pages[window.appState.currentPage];
  if (page && typeof page.destroy === 'function') {
    try { page.destroy(); } catch (e) { /* noop */ }
  }
  window.appState.currentPage = null;
}

function renderPage(pageName, params) {
  destroyCurrentPage();

  const page = window.pages[pageName];
  if (!page) {
    pageContainer.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back-fallback">${uhmBackArrow(window.appState.lang)}</button>
        <h2>${window.i18n.t(window.appState.lang, 'common.back')} / Coming soon</h2>
      </div>
      <div class="empty-state">
        <div class="empty-icon">🚧</div>
        <div class="text-dim">${window.i18n.t(window.appState.lang, 'common.pageMissing')}</div>
      </div>
    `;
    document.getElementById('btn-back-fallback').addEventListener('click', () => navigate('showcase'));
    return;
  }

  pageContainer.innerHTML = '';
  window.appState.currentPage = pageName;
  page.render(pageContainer, params || {});
}

function navigate(pageName, params, options = {}) {
  const { replace = false } = options;
  if (!replace && window.appState.currentPage) {
    window.appState.navStack.push(window.appState.currentPage);
  }
  renderPage(pageName, params);
  document.getElementById('page-content').scrollTop = 0;
}

function goBack(fallback = 'showcase') {
  destroyCurrentPage();
  const target = window.appState.navStack.pop() || fallback;
  renderPage(target, {});
  document.getElementById('page-content').scrollTop = 0;
}

window.navigate = navigate;
window.goBack = goBack;

/* ------------------------------------------------------------------ */
/*  Titlebar                                                           */
/* ------------------------------------------------------------------ */
function wireTitlebar() {
  document.getElementById('btn-minimize').addEventListener('click', () => window.uhm.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.uhm.windowToggleMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.uhm.windowClose());

  document.getElementById('btn-theme-toggle').addEventListener('click', async () => {
    const newTheme = window.appState.theme === 'night' ? 'day' : 'night';
    applyTheme(newTheme);
    await window.uhm.setSettings({ theme: newTheme });
    window.appState.settings.theme = newTheme;
    uhmToast(window.i18n.t(window.appState.lang, 'toast.theme'), 'success', 1300);
  });

  document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));
}

/* ------------------------------------------------------------------ */
/*  Global drag-and-drop target (install a mod from anywhere)          */
/* ------------------------------------------------------------------ */

function wireDropTarget() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-overlay-inner">
      <div class="drop-overlay-icon">📦</div>
      <div class="drop-overlay-title">${window.i18n.t(window.appState.lang, 'modInstall.dropTitle')}</div>
      <div class="drop-overlay-sub">${window.i18n.t(window.appState.lang, 'modInstall.dropSub')}</div>
    </div>`;
  document.body.appendChild(overlay);

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    overlay.classList.add('open');
  });

  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('open');
  });

  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('open');

    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const paths = [];
    for (const f of files) {
      const p = window.uhm.getPathForFile ? window.uhm.getPathForFile(f) : null;
      if (p) paths.push(p);
    }
    if (!paths.length) {
      uhmToast(window.i18n.t(window.appState.lang, 'toast.error'), 'error');
      return;
    }
    navigate('modInstall', { sources: paths });
  });
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  const settings = await window.uhm.getSettings();
  const manifest = await window.uhm.getManifest();
  window.appState.settings = settings || {};
  window.appState.manifest = manifest || {};

  applyTheme(settings.theme || 'night');
  applyLanguage(settings.language || 'fa');
  wireTitlebar();
  wireDropTarget();

  window.appState.navStack = [];
  renderPage('showcase', {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
