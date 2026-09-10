/* ================================================================= */
/*  Mod Install — drag-and-drop installer (Content Manager-like)      */
/*                                                                    */
/*  Flow: pick/drop a source → analyze (type detection, metadata,     */
/*  preview, conflict plan) → review & select items → install with    */
/*  live progress → done summary.                                     */
/* ================================================================= */

(function () {
  'use strict';

  const TYPE_ICON = {
    car: '🚗',
    track: '📍',
    skin: '🎨',
    app: '🧩',
    ppfilter: '🖼',
    font: '🔤',
    weather: '🌦',
    driver: '🏁',
    mirror: '📦'
  };

  let state = {
    sources: [],
    gamePath: null,
    phase: 'idle',       // idle | analyzing | password | review | installing | done
    results: [],         // analyzeSource results (one per source)
    selected: {},        // item key -> boolean
    progressUnsub: null,
    busy: false,
    password: ''         // resolved archive password (if any)
  };

  function lang() { return window.appState.lang; }
  function t(key) { return window.i18n.t(lang(), key); }
  function s(key) { return window.i18n.t(lang(), 'modInstall.' + key); }
  function typeLabel(type) { return s('types' + type.charAt(0).toUpperCase() + type.slice(1)); }
  function typeIcon(type) { return TYPE_ICON[type] || '📦'; }
  function basename(p) { return String(p || '').replace(/\\/g, '/').split('/').pop() || p; }
  function fmtBytes(n) { return window.libraryData ? window.libraryData.formatBytes(n) : String(n || 0); }
  function fmtCount(n) { return window.libraryData ? window.libraryData.formatCount(n) : String(n || 0); }

  function render(container, params) {
    const p = params || {};
    state.sources = Array.isArray(p.sources) ? p.sources.filter(Boolean)
      : (p.source ? [p.source] : []);
    state.gamePath = window.appState.settings && window.appState.settings.gamePath;
    state.phase = 'idle';
    state.results = [];
    state.selected = {};
    state.busy = false;
    state.password = '';
    if (state.progressUnsub) { state.progressUnsub(); state.progressUnsub = null; }

    if (!state.gamePath) {
      renderNoPath(container);
      return;
    }
    if (!state.sources.length) {
      renderPick(container);
      return;
    }
    runAnalyze(container);
  }

  /* ------------------------------------------------------------------ */
  /*  Empty states                                                       */
  /* ------------------------------------------------------------------ */

  function renderNoPath(container) {
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
        </div>
      </div>
      <section class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="empty-title">${s('noGamePath')}</div>
        <button class="btn-primary" id="btn-set-path">${t('gamePath.title')}</button>
      </section>`;
    document.getElementById('btn-back').addEventListener('click', () => goBack('library'));
    document.getElementById('btn-set-path').addEventListener('click', () => navigate('gamePath'));
  }

  function renderPick(container) {
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('subtitle')}</div>
        </div>
      </div>
      <section class="mi-dropzone" id="mi-dropzone">
        <div class="mi-dropzone-icon">📦</div>
        <div class="mi-dropzone-title">${s('dropTitle')}</div>
        <div class="text-dim">${s('dropSub')}</div>
        <button class="btn-primary" id="btn-browse">${s('browse')}</button>
      </section>`;
    document.getElementById('btn-back').addEventListener('click', () => goBack('library'));
    document.getElementById('btn-browse').addEventListener('click', pickAndGo);
    document.getElementById('mi-dropzone').addEventListener('click', pickAndGo);
  }

  async function pickAndGo() {
    const paths = await window.uhm.pickModFiles();
    if (paths && paths.length) {
      navigate('modInstall', { sources: paths });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Analyze                                                            */
  /* ------------------------------------------------------------------ */

  async function runAnalyze(container, password) {
    state.phase = 'analyzing';
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
        </div>
      </div>
      <div class="mi-analyzing">
        <div class="loader"></div>
        <div class="text-dim">${s('analyzing')}</div>
      </div>`;
    document.getElementById('btn-back').addEventListener('click', () => goBack('library'));

    const results = [];
    for (let i = 0; i < state.sources.length; i += 1) {
      const src = state.sources[i];
      try {
        const r = await window.uhm.analyzeModSource({
          sourcePath: src,
          gamePath: state.gamePath,
          password: password || ''
        });
        if (r && Array.isArray(r.items)) {
          r.items.forEach((it) => { it._key = i + ':' + (it.id || it.name); it._srcLabel = basename(src); });
        }
        results.push(r);
      } catch (e) {
        results.push({ ok: false, error: 'READ_FAILED', source: { label: basename(src) } });
      }
    }
    state.results = results;

    // A password-protected archive needs a password before we can review it.
    const pwNeeded = results.find((r) => r && r.error === 'PASSWORD_REQUIRED');
    const pwWrong = results.find((r) => r && r.error === 'PASSWORD_INCORRECT');
    if (pwNeeded || pwWrong) {
      renderPasswordPrompt(container, Boolean(pwWrong));
      return;
    }

    state.password = password || '';
    renderReview(container);
  }

  /* ------------------------------------------------------------------ */
  /*  Password prompt (encrypted RAR)                                    */
  /* ------------------------------------------------------------------ */

  function renderPasswordPrompt(container, incorrect) {
    state.phase = 'password';
    const label = state.sources.map(basename).filter(Boolean).join(' · ') || '—';
    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
        </div>
      </div>
      <div class="page-stack">
        <section class="card-sec mi-password">
          <div class="mi-password-icon">🔒</div>
          <div class="mi-password-title">${s('passwordTitle')}</div>
          <div class="text-dim mi-password-sub">${s('passwordSub')}</div>
          <div class="mi-chip">📄 ${uhmEsc(label)}</div>
          <input type="password" id="mi-password-input" class="mi-password-input"
                 placeholder="${s('passwordPlaceholder')}" autocomplete="off"
                 spellcheck="false" autocapitalize="off" />
          <div class="mi-password-error" id="mi-password-error" ${incorrect ? '' : 'style="display:none"'}>
            ${s('passwordIncorrect')}
          </div>
          <div class="wizard-footer">
            <button class="btn-secondary" id="btn-pw-cancel">${s('cancel')}</button>
            <button class="btn-primary" id="btn-pw-unlock">${s('passwordSubmit')}</button>
          </div>
        </section>
      </div>`;

    document.getElementById('btn-back').addEventListener('click', () => goBack('library'));
    document.getElementById('btn-pw-cancel').addEventListener('click', () => goBack('library'));

    const input = document.getElementById('mi-password-input');
    const submit = () => {
      const pw = input.value;
      if (!pw) {
        input.focus();
        const err = document.getElementById('mi-password-error');
        if (err) err.style.display = '';
        return;
      }
      runAnalyze(container, pw);
    };
    document.getElementById('btn-pw-unlock').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  /* ------------------------------------------------------------------ */
  /*  Review                                                             */
  /* ------------------------------------------------------------------ */

  function allItems() {
    const out = [];
    for (const r of state.results) {
      if (r && r.ok && Array.isArray(r.items)) out.push(...r.items);
    }
    return out;
  }

  function selectedItems() {
    return allItems().filter((it) => state.selected[it._key] !== false);
  }

  function renderReview(container) {
    state.phase = 'review';
    const items = allItems();
    const anyFailed = state.results.some((r) => !r.ok);
    const anyItems = items.length > 0;

    // Default-select everything that is installable.
    items.forEach((it) => {
      if (!(it._key in state.selected)) state.selected[it._key] = true;
    });

    const sourceSummary = state.results.map((r) => {
      const label = (r && r.source && r.source.label) || '—';
      const size = (r && r.source && r.source.sizeBytes) ? fmtBytes(r.source.sizeBytes) : '—';
      return `<span class="mi-chip">📄 ${uhmEsc(label)} · ${uhmEsc(size)}</span>`;
    }).join('');

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('reviewSub')}</div>
        </div>
      </div>

      <div class="page-stack">
        <section class="ui-section">
          ${window.ui.sectionHeader({ icon: '📦', kicker: 'Source', title: s('reviewTitle'), subtitle: '' })}
          <div class="mi-source-strip">${sourceSummary || `<span class="text-dim">—</span>`}</div>
        </section>

        ${anyFailed ? failedBanner() : ''}

        ${anyItems ? `
        <section class="ui-section">
          <div class="mi-toolbar">
            <label class="mi-select-all">
              <input type="checkbox" id="mi-select-all" checked />
              <span>${s('selectAll')}</span>
            </label>
            <span class="text-dim">${fmtCount(items.length)} ${s('entries')}</span>
          </div>
          <div class="mi-list" id="mi-list">
            ${items.map(itemCard).join('')}
          </div>
        </section>` : `
        <section class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">${s('nothing')}</div>
          <div class="text-dim">${s('nothingHint')}</div>
        </section>`}
      </div>

      <div class="wizard-footer">
        <button class="btn-secondary" id="btn-back2">${s('cancel')}</button>
        ${anyItems ? `<button class="btn-primary" id="btn-install" ${anyFailed ? '' : ''}>
          <span>${s('install')}</span>
        </button>` : ''}
      </div>`;

    document.getElementById('btn-back').addEventListener('click', () => goBack('library'));
    const back2 = document.getElementById('btn-back2');
    if (back2) back2.addEventListener('click', () => goBack('library'));

    const selectAll = document.getElementById('mi-select-all');
    if (selectAll) selectAll.addEventListener('change', (e) => {
      const on = e.target.checked;
      items.forEach((it) => { state.selected[it._key] = on; });
      container.querySelectorAll('.mi-check').forEach((c) => { c.checked = on; });
    });

    container.querySelectorAll('.mi-check').forEach((c) => {
      c.addEventListener('change', () => {
        state.selected[c.dataset.key] = c.checked;
        const all = container.querySelectorAll('.mi-check');
        const allOn = [...all].every((x) => x.checked);
        if (selectAll) selectAll.checked = allOn;
      });
    });

    const installBtn = document.getElementById('btn-install');
    if (installBtn) installBtn.addEventListener('click', () => startInstall(container));
  }

  function failedBanner() {
    const label = state.results.some((r) => r.error === 'UNSUPPORTED_FORMAT')
      ? s('unsupportedHint') : s('readFailed');
    return `
      <div class="mi-banner mi-banner-warn">
        <span>⚠️</span><span>${label}</span>
      </div>`;
  }

  function itemCard(it) {
    const checked = state.selected[it._key] !== false ? 'checked' : '';
    const name = uhmEsc(it.displayName || it.name);
    const metaParts = [];
    if (it.author) metaParts.push(uhmEsc(it.author));
    if (it.version) metaParts.push(`${s('version')}: ${uhmEsc(it.version)}`);
    const meta = metaParts.join(' · ');

    const type = uhmEsc(typeLabel(it.type));
    const target = it.targetRelative ? uhmEsc(it.targetRelative) : '';
    const fileCount = it.fileCount != null ? fmtCount(it.fileCount) : '0';
    const size = it.sizeBytes ? fmtBytes(it.sizeBytes) : '';

    let statusBadge = '';
    if (it.status === 'update') {
      statusBadge = `<span class="mi-badge mi-badge-update">🔄 ${s('statusUpdate')}</span>`;
    } else if (it.status === 'same') {
      statusBadge = `<span class="mi-badge mi-badge-same">✓ ${s('statusSame')}</span>`;
    } else {
      statusBadge = `<span class="mi-badge mi-badge-new">✨ ${s('statusNew')}</span>`;
    }

    const conflict = it.status === 'update'
      ? `<div class="mi-conflict">⚠️ ${s('conflictWarn')}<br/>${s('overwrite').replace('{n}', fmtCount(it.overwriteCount || 0))}${it.addCount ? ' · ' + s('add').replace('{n}', fmtCount(it.addCount)) : ''}</div>`
      : (it.status === 'same' ? `<div class="text-dim">${s('statusSame')}</div>` : '');

    const mirrorWarn = it.type === 'mirror' ? `<div class="mi-conflict">⚠️ ${s('mirrorWarn')}</div>` : '';
    const skinNote = it.type === 'skin' && it.car ? `<div class="text-dim">${s('skinFor').replace('{car}', uhmEsc(it.car))}</div>` : '';

    const preview = it.previewDataUrl
      ? `<div class="mi-preview"><img src="${it.previewDataUrl}" alt="" /></div>`
      : `<div class="mi-preview mi-preview-empty"><span>${typeIcon(it.type)}</span></div>`;

    return `
      <div class="card-sec mi-item" data-key="${uhmEsc(it._key)}">
        <label class="mi-check-wrap">
          <input class="mi-check" type="checkbox" data-key="${uhmEsc(it._key)}" ${checked} />
        </label>
        ${preview}
        <div class="mi-item-body">
          <div class="mi-item-head">
            <span class="mi-type">${typeIcon(it.type)} ${type}</span>
            ${statusBadge}
          </div>
          <div class="mi-item-name">${name}</div>
          ${meta ? `<div class="text-dim">${meta}</div>` : ''}
          ${it.description ? `<div class="mi-item-desc">${uhmEsc(it.description)}</div>` : ''}
          ${skinNote}
          ${conflict}
          ${mirrorWarn}
          <div class="mi-item-meta text-dim">
            <span>📁 ${target}</span>
            <span>· ${fileCount} ${s('filesCount')}${size ? ' · ' + size : ''}</span>
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Install                                                            */
  /* ------------------------------------------------------------------ */

  function startInstall(container) {
    const items = selectedItems();
    if (!items.length) return;
    state.phase = 'installing';
    state.busy = true;

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
          <div class="text-dim">${s('installing')}</div>
        </div>
      </div>
      <div class="page-stack">
        <section class="ui-section">
          <div class="card-sec">
            <div class="mi-progress-head">
              <span id="mi-progress-label">${s('installing')}</span>
              <span id="mi-progress-count">0 / ${items.length}</span>
            </div>
            <div class="ui-progress-track"><div class="ui-progress-bar" id="mi-progress-bar" style="width:0%"></div></div>
            <div class="mi-status-list" id="mi-status-list">
              ${items.map((it, i) => `<div class="mi-status-row" data-index="${i}">
                <span class="mi-status-icon">⏳</span>
                <span class="mi-status-name">${uhmEsc(it.displayName || it.name)}</span>
              </div>`).join('')}
            </div>
          </div>
        </section>
      </div>
      <div class="wizard-footer">
        <button class="btn-secondary" id="btn-cancel">${s('cancel')}</button>
      </div>`;

    document.getElementById('btn-back').addEventListener('click', () => {
      if (!state.busy) goBack('library');
    });
    document.getElementById('btn-cancel').addEventListener('click', async () => {
      await window.uhm.cancelModInstall();
      const btn = document.getElementById('btn-cancel');
      if (btn) { btn.disabled = true; btn.textContent = t('common.cancel'); }
    });

    if (state.progressUnsub) { state.progressUnsub(); }
    state.progressUnsub = window.uhm.onModInstallProgress
      ? window.uhm.onModInstallProgress(handleProgress)
      : null;

    const payloadItems = items.map((it) => ({
      id: it.id || `${it.type}:${it.name}`,
      type: it.type,
      name: it.name,
      car: it.car,
      sourceRoot: it.sourceRoot,
      files: it.files
    }));

    const sourcePath = state.sources[0];

    window.uhm.installMod({
      sourcePath,
      items: payloadItems,
      gamePath: state.gamePath,
      password: state.password || ''
    })
      .then((result) => {
        if (state.progressUnsub) { state.progressUnsub(); state.progressUnsub = null; }
        state.busy = false;
        // The archive may have changed on disk; if the password is no longer
        // valid, send the user back to the password prompt.
        if (result && result.error === 'PASSWORD_INCORRECT') {
          state.password = '';
          renderPasswordPrompt(container, true);
          return;
        }
        renderDone(container, result);
      })
      .catch((e) => {
        if (state.progressUnsub) { state.progressUnsub(); state.progressUnsub = null; }
        state.busy = false;
        renderDone(container, { success: false, cancelled: false, error: e.message, items: [] });
      });
  }

  function handleProgress(p) {
    if (!p) return;
    const bar = document.getElementById('mi-progress-bar');
    const count = document.getElementById('mi-progress-count');
    const label = document.getElementById('mi-progress-label');
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    if (bar) bar.style.width = pct + '%';
    if (count) count.textContent = `${p.done} / ${p.total}`;
    if (label && p.item) label.textContent = `${typeLabel(p.item.type)} · ${p.item.name}`;

    const row = document.querySelector(`.mi-status-row[data-index="${(p.done || 1) - 1}"]`);
    if (row && p.item) {
      const icon = row.querySelector('.mi-status-icon');
      if (icon) {
        icon.textContent = p.item.status === 'installed' ? '✅'
          : p.item.status === 'error' ? '❌'
          : p.item.status === 'skipped' ? '🕐' : '⚙️';
      }
    }
  }

  function renderDone(container, result) {
    state.phase = 'done';
    const items = result.items || [];
    const installed = items.filter((r) => r.status === 'installed').length;
    const failed = items.filter((r) => r.status === 'error').length;
    const success = Boolean(result && result.success);

    container.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="btn-back">${uhmBackArrow(lang())}</button>
        <div class="page-header-copy">
          <h2>${s('title')}</h2>
        </div>
      </div>
      <div class="page-stack">
        <section class="card-sec done-hero ${success ? 'done-success' : 'done-error'}">
          <div class="done-icon">${success ? '🎉' : '⚠️'}</div>
          <h2 class="done-title">${success ? s('doneTitle') : (result && result.cancelled ? t('common.cancel') : s('donePartial'))}</h2>
          <div class="text-dim done-subtitle">${success ? s('doneSub') : s('errorInstall')}</div>
        </section>

        ${items.length ? `
        <section class="ui-section">
          ${window.ui.sectionHeader({ icon: '🧾', kicker: 'Result', title: s('reviewTitle'), subtitle: '' })}
          <div class="card-sec mi-status-list">
            ${items.map((r) => {
              const icon = r.status === 'installed' ? '✅' : r.status === 'error' ? '❌' : '🕐';
              return `<div class="mi-status-row">
                <span class="mi-status-icon">${icon}</span>
                <span class="mi-status-name">${uhmEsc(r.name)}</span>
                <span class="text-dim">${uhmEsc(r.status || '')}</span>
              </div>`;
            }).join('')}
          </div>
        </section>` : ''}

        <div class="done-actions">
          <button class="btn-primary" id="btn-library">${s('goLibrary')}</button>
          <button class="btn-secondary" id="btn-another">${s('installAnother')}</button>
        </div>
      </div>`;

    document.getElementById('btn-back').addEventListener('click', () => {
      window.appState.navStack = [];
      navigate('library', {}, { replace: true });
    });
    document.getElementById('btn-library').addEventListener('click', () => {
      window.appState.navStack = [];
      navigate('library', {}, { replace: true });
    });
    document.getElementById('btn-another').addEventListener('click', () => {
      navigate('modInstall', { sources: [] });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  function destroy() {
    if (state.progressUnsub) { state.progressUnsub(); state.progressUnsub = null; }
    state.busy = false;
  }

  window.pages.modInstall = { render, destroy };
})();
