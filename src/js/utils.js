// توابع کمکی مشترک در کل اپلیکیشن

function uhmEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uhmBackArrow(lang) {
  return lang === 'fa' ? '←' : '→';
}

function uhmFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return d.toLocaleString();
  }
}

function uhmToast(message, type = 'info', duration = 2600) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  wrap.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

function uhmConfirm({ title = '', body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-wrap');
    if (!overlay) return resolve(false);
    overlay.classList.add('open');

    overlay.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card ${danger ? 'modal-danger' : ''}">
        <div class="modal-title">${uhmEsc(title)}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button class="btn-secondary" data-modal="cancel">${uhmEsc(cancel)}</button>
          <button class="btn-primary" data-modal="ok">${uhmEsc(ok)}</button>
        </div>
      </div>
    `;

    const close = (value) => {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      resolve(value);
    };

    overlay.querySelector('.modal-backdrop').addEventListener('click', () => close(false));
    overlay.querySelector('[data-modal="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-modal="ok"]').addEventListener('click', () => close(true));
  });
}

window.uhmEsc = uhmEsc;
window.uhmBackArrow = uhmBackArrow;
window.uhmFormatDate = uhmFormatDate;
window.uhmToast = uhmToast;
window.uhmConfirm = uhmConfirm;
