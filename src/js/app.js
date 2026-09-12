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
const THEME_ICONS = {
  day: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>',
  night: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
};

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme || 'night');
  window.appState.theme = theme || 'night';
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.innerHTML = THEME_ICONS[window.appState.theme === 'day' ? 'day' : 'night'];
}

function applyLanguage(lang) {
  const dir = window.i18n.t(lang, 'dir');
  document.body.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang || 'fa');
  window.appState.lang = lang || 'fa';
  const label = document.getElementById('app-name-label');
  if (label) label.textContent = window.i18n.t(lang, 'appName');

  // Localize the static titlebar controls' tooltips too.
  const titlebarTitles = {
    'btn-theme-toggle': 'window.theme',
    'btn-settings': 'window.settings',
    'btn-minimize': 'window.minimize',
    'btn-maximize': 'window.maximize',
    'btn-close': 'window.close'
  };
  Object.keys(titlebarTitles).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.title = window.i18n.t(lang, titlebarTitles[id]);
  });
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
        <div class="empty-icon"></div>
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
// Exposed so other page modules (loaded as separate classic scripts) can call
// them directly, mirroring the existing navigate/goBack globals.
window.applyTheme = applyTheme;
window.applyLanguage = applyLanguage;

/* ------------------------------------------------------------------ */
/*  Global shortcuts & right-click back                                */
/* ------------------------------------------------------------------ */
const LANGUAGES = ['fa', 'en', 'zh', 'ja'];

async function cycleLanguage() {
  const current = window.appState.lang || 'fa';
  const idx = LANGUAGES.indexOf(current);
  const next = LANGUAGES[(idx + 1) % LANGUAGES.length];
  await window.uhm.setSettings({ language: next });
  applyLanguage(next);
  if (window.appState.settings) window.appState.settings.language = next;
  // Re-render the current page so all visible strings update immediately.
  // Skip pages that depend on transient params (install / mod install / done).
  const FLOW_PAGES = ['install', 'modInstall', 'done'];
  if (window.appState.currentPage && FLOW_PAGES.indexOf(window.appState.currentPage) === -1) {
    renderPage(window.appState.currentPage, {});
  }
  uhmToast(window.i18n.t(next, 'toast.lang'), 'success', 1300);
}

async function toggleTheme() {
  const newTheme = window.appState.theme === 'night' ? 'day' : 'night';
  applyTheme(newTheme);
  await window.uhm.setSettings({ theme: newTheme });
  if (window.appState.settings) window.appState.settings.theme = newTheme;
  uhmToast(window.i18n.t(window.appState.lang, 'toast.theme'), 'success', 1300);
}

window.cycleLanguage = cycleLanguage;
window.toggleTheme = toggleTheme;

function wireGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'l') {
      e.preventDefault();
      cycleLanguage();
    } else if (key === 'd') {
      e.preventDefault();
      toggleTheme();
    }
  });

  // Right-click has no other use in the app: make it a browser-style Back.
  // The one exception is editable fields (the game-path input) — there the
  // native menu must stay usable so users can still Paste a copied path.
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    const isEditable = t && (
      t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
    );
    if (isEditable) return;
    e.preventDefault();
    if (window.appState.navStack.length) goBack();
  });
}

/* ------------------------------------------------------------------ */
/*  Titlebar                                                           */
/* ------------------------------------------------------------------ */
function wireTitlebar() {
  document.getElementById('btn-minimize').addEventListener('click', () => window.uhm.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.uhm.windowToggleMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.uhm.windowClose());

  document.getElementById('btn-theme-toggle').addEventListener('click', () => toggleTheme());

  document.getElementById('btn-settings').addEventListener('click', () => navigate('settings'));

  // Frameless window drag. Electron used CSS `-webkit-app-region: drag`;
  // WebView2 (Tauri) has no such thing, so we start a native drag on
  // mousedown anywhere in the titlebar except its buttons.
  const titlebar = document.getElementById('titlebar');
  titlebar.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.titlebar-actions')) return;
    if (window.uhm && typeof window.uhm.windowStartDrag === 'function') {
      e.preventDefault();
      window.uhm.windowStartDrag();
    }
  });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.titlebar-actions')) return;
    window.uhm.windowToggleMaximize();
  });
}

/* ------------------------------------------------------------------ */
/*  Global drag-and-drop target (install a mod from anywhere)          */
/* ------------------------------------------------------------------ */

function wireDropTarget() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-overlay-inner">
      <div class="drop-overlay-icon"></div>
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
    if (window.uhm && window.uhm.runtime === 'tauri') return; // handled natively by tauri-bridge.js
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
  wireGlobalShortcuts();

  window.appState.navStack = [];
  renderPage('showcase', {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
