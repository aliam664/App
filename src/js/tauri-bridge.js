/* ------------------------------------------------------------------ */
/*  Tauri bridge — replaces the old Electron preload.js                 */
/*                                                                     */
/*  Exposes the exact same `window.uhm` API the pages already use, but  */
/*  backed by Tauri `invoke` / `listen` instead of ipcRenderer. Keeping  */
/*  the surface identical means zero changes in the page code.          */
/*                                                                     */
/*  Load order: this file must run BEFORE browser-preview.js so the demo */
/*  shim only kicks in when we are really in a plain browser.           */
/* ------------------------------------------------------------------ */
(function () {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return; // plain browser → demo shim
  if (window.uhm) return;

  const { invoke } = tauri.core;
  const { listen } = tauri.event;

  /* Subscribe to a backend event. Returns an unsubscribe function
     synchronously (the pages call it directly), even though Tauri's
     listen() resolves asynchronously. */
  function subscribe(channel, callback) {
    let disposed = false;
    let unlisten = null;
    listen(channel, (event) => { if (!disposed) callback(event.payload); })
      .then((fn) => { if (disposed) fn(); else unlisten = fn; })
      .catch(() => {});
    return () => { disposed = true; if (unlisten) { unlisten(); unlisten = null; } };
  }

  /* Native drag-and-drop: Tauri delivers dropped *paths* through its own
     event (the DOM drop event only carries File objects with no path). We
     forward them to the same navigation the app already implements. */
  const droppedPaths = { pending: null };
  if (tauri.webview && tauri.webview.getCurrentWebview) {
    try {
      tauri.webview.getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload || {};
        const overlay = document.querySelector('.drop-overlay');
        if (p.type === 'enter' || p.type === 'over') {
          if (overlay) overlay.classList.add('open');
        } else if (p.type === 'leave') {
          if (overlay) overlay.classList.remove('open');
        } else if (p.type === 'drop') {
          if (overlay) overlay.classList.remove('open');
          const paths = Array.isArray(p.paths) ? p.paths.filter(Boolean) : [];
          if (!paths.length) return;
          if (typeof window.navigate === 'function') window.navigate('modInstall', { sources: paths });
          else droppedPaths.pending = paths;
        }
      }).catch(() => {});
    } catch (e) { /* older webview — file picker still works */ }
  }

  window.uhm = {
    // window controls
    windowMinimize: () => invoke('window_minimize'),
    windowToggleMaximize: () => invoke('window_toggle_maximize'),
    windowClose: () => invoke('window_close'),
    windowStartDrag: () => invoke('window_start_drag'),

    // settings / manifest
    getSettings: () => invoke('settings_get'),
    setSettings: (partial) => invoke('settings_set', { partial }),
    getManifest: () => invoke('manifest_get'),
    saveManifest: (data) => invoke('manifest_save', { data }),

    // game path
    browseGamePath: () => invoke('game_browse_path'),
    validateGamePath: (gamePath) => invoke('game_validate_path', { gamePath }),
    autoDetectGamePath: () => invoke('game_auto_detect'),
    checkBaseMods: (gamePath) => invoke('game_check_base_mods', { gamePath }),

    // hardware
    detectSystemSpecs: (options) => invoke('system_detect_specs', { options: options || null }),
    suggestTier: (specs) => invoke('system_suggest_tier', { specs: specs || null }),

    // content library
    scanLibrary: (gamePath) => invoke('library_scan', { gamePath }),
    getContentPreview: (payload) => invoke('library_get_preview', { payload }),
    revealContent: (payload) => invoke('library_reveal', { payload }),
    deleteContent: (payload) => invoke('library_delete', { payload }),
    restoreContent: (payload) => invoke('library_restore', { payload }),
    purgeContent: (payload) => invoke('library_purge', { payload }),
    emptyTrash: () => invoke('library_empty_trash'),
    listTrash: () => invoke('library_trash'),
    getPreviewCandidates: (type) => invoke('library_preview_candidates', { kind: type }),

    // tier-pack install / uninstall
    runInstall: (payload) => invoke('install_run', { payload }),
    cancelInstall: () => invoke('install_cancel'),
    runUninstall: (payload) => invoke('uninstall_run', { payload }),

    // drag-and-drop mod install
    getPathForFile: () => null, // paths come from onDragDropEvent instead
    analyzeModSource: (payload) => invoke('mods_analyze', { payload }),
    installMod: (payload) => invoke('mods_install', { payload }),
    cancelModInstall: () => invoke('mods_cancel'),
    pickModFiles: () => invoke('mods_pick_file'),

    // progress events
    onModInstallProgress: (cb) => subscribe('mods:install-progress', cb),
    onInstallProgress: (cb) => subscribe('install:progress', cb),
    onScanProgress: (cb) => subscribe('library:scan-progress', cb),

    // shell / clipboard
    openExternal: (url) => invoke('shell_open_external', { url }),
    copyText: (text) => invoke('clipboard_write', { text: String(text == null ? '' : text) }),

    // runtime marker
    runtime: 'tauri'
  };

  // Flush a drop that happened before app.js defined navigate().
  document.addEventListener('DOMContentLoaded', () => {
    if (droppedPaths.pending && typeof window.navigate === 'function') {
      const p = droppedPaths.pending; droppedPaths.pending = null;
      setTimeout(() => window.navigate('modInstall', { sources: p }), 50);
    }
  });
})();
