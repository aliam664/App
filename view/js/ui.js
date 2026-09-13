/* ================================================================= */
/*  UHM Pack Installer — shared UI building blocks                   */
/*                                                                    */
/*  Pure template helpers used by every page so the whole app shares  */
/*  one consistent design language. No DOM side-effects here.         */
/* ================================================================= */

(function (root) {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sectionHeader(t) {
    return `
      <div class="ui-section-head">
        ${t.icon ? `<span class="ui-section-icon">${t.icon}</span>` : ''}
        <div class="ui-section-copy">
          ${t.kicker ? `<div class="ui-section-kicker">${esc(t.kicker)}</div>` : ''}
          <div class="ui-section-title">${esc(t.title || '')}</div>
          ${t.subtitle ? `<div class="ui-section-sub title-dim">${esc(t.subtitle)}</div>` : ''}
        </div>
      </div>`;
  }

  function statCard(icon, label, value, accent) {
    return `
      <div class="ui-stat ${accent ? 'ui-stat-' + accent : ''}">
        <div class="ui-stat-icon">${icon}</div>
        <div class="ui-stat-value">${esc(value)}</div>
        <div class="ui-stat-label title-dim">${esc(label)}</div>
      </div>`;
  }

  function statusBadge(text, variant) {
    const cls = ['ui-badge', variant ? 'ui-badge-' + variant : 'ui-badge-muted'].join(' ');
    return `<span class="${cls}">${esc(text)}</span>`;
  }

  function chip(text, variant) {
    const cls = ['ui-chip', variant ? 'ui-chip-' + variant : ''].join(' ');
    return `<span class="${cls}">${esc(text)}</span>`;
  }

  function infoRow(label, value, variant) {
    return `
      <div class="ui-info-row">
        <span class="ui-info-label title-dim">${esc(label)}</span>
        <span class="ui-info-value ${variant ? 'ui-info-value-' + variant : ''}">${value == null || value === '' ? '—' : esc(value)}</span>
      </div>`;
  }

  function progress(percent, label) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `
      <div class="ui-progress">
        <div class="ui-progress-track"><div class="ui-progress-bar" style="width:${p}%"></div></div>
        <div class="ui-progress-text title-dim">${label == null ? p + '%' : label}</div>
      </div>`;
  }

  function empty(icon, title, hint, actionHtml) {
    return `
      <div class="ui-empty">
        <div class="ui-empty-icon">${icon}</div>
        <div class="ui-empty-title">${title}</div>
        ${hint ? `<div class="ui-empty-hint title-dim">${hint}</div>` : ''}
        ${actionHtml ? `<div class="ui-empty-action">${actionHtml}</div>` : ''}
      </div>`;
  }

  function sectionOpen(id, cls) {
    return `<section class="ui-section ${cls || ''}"${id ? ` id="${esc(id)}"` : ''}>`;
  }

  function sectionClose() {
    return '</section>';
  }

  root.ui = {
    esc,
    sectionHeader,
    statCard,
    statusBadge,
    chip,
    infoRow,
    progress,
    empty,
    sectionOpen,
    sectionClose
  };
})(typeof window !== 'undefined' ? window : globalThis);
