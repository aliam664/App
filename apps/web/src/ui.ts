import {
  createIcons,
  ArrowLeft,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownToLine,
  ArrowDown,
  BadgeCheck,
  Bell,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronsUpDown,
  CircleCheck,
  Clock3,
  Compass,
  Download,
  FlaskConical,
  Folder,
  FolderCheck,
  FolderCog,
  CalendarDays,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Info,
  KeyRound,
  Layers2,
  LayoutDashboard,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Monitor,
  Package,
  PackageOpen,
  Plus,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  SearchX,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Users,
  WifiOff,
  X,
} from 'lucide';
const icons = {
  ArrowLeft,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownToLine,
  ArrowDown,
  BadgeCheck,
  Bell,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronsUpDown,
  CircleCheck,
  Clock3,
  Compass,
  Download,
  FlaskConical,
  Folder,
  FolderCheck,
  FolderCog,
  CalendarDays,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Info,
  KeyRound,
  Layers2,
  LayoutDashboard,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Monitor,
  Package,
  PackageOpen,
  Plus,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  SearchX,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Users,
  WifiOff,
  X,
};
import { ApiError, messages } from './api';
export const esc = (x: unknown) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
export const decorate = () =>
  createIcons({ icons, attrs: { 'stroke-width': 1.6, 'aria-hidden': 'true', focusable: 'false' } });
export const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
export const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
export const size = (bytes: number) =>
  bytes
    ? `${(bytes / (bytes >= 1e9 ? 1e9 : 1e6)).toFixed(1)} ${bytes >= 1e9 ? 'GB' : 'MB'}`
    : 'فایل متصل نشده';
export const tierLabel = (tier: string) =>
  ({ normal: 'Normal', pro: 'Pro', vip: 'VIP' })[tier] || tier;
export const badge = (tier: string) =>
  `<span class="tier tier-${esc(tier)}" dir="ltr">${tierLabel(tier)}</span>`;
export const category: Record<string, string> = {
  graphics: 'گرافیک و نور',
  tracks: 'مسیرها',
  cars: 'خودروها',
  tools: 'ابزارهای پایه',
};
export function toast(text: string, danger = false) {
  let stack = document.querySelector<HTMLElement>('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.append(stack);
  }
  const el = document.createElement('div');
  el.className = `toast ${danger ? 'danger' : ''}`;
  el.setAttribute('role', danger ? 'alert' : 'status');
  const message = document.createElement('span');
  message.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'بستن پیام');
  close.textContent = '×';
  close.onclick = () => el.remove();
  el.append(message, close);
  stack.append(el);
  while (stack.children.length > 3) stack.firstElementChild?.remove();
  setTimeout(() => el.remove(), danger ? 10000 : 6500);
}
export const handleError = (e: unknown) =>
  toast(
    e instanceof ApiError
      ? (messages[e.code] || e.code) + (e.detail ? ` ${e.detail}` : '')
      : e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : 'خطای غیرمنتظره',
    true,
  );
export function modal(title: string, content: string, wide = false): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = wide ? 'modal wide' : 'modal';
  const titleId = `dialog-${crypto.randomUUID()}`;
  const opener = document.activeElement;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<div class="modal-head"><h2 id="${titleId}">${esc(title)}</h2><button class="icon-button" data-close aria-label="بستن">${icon('x')}</button></div><div class="modal-body">${content}</div>`;
  document.body.append(dialog);
  const requestClose = () => {
    if (
      dialog.dataset.dirty === 'true' &&
      !window.confirm('تغییرات این فرم ذخیره نشده است. بدون ذخیره بسته شود؟')
    )
      return;
    dialog.close();
  };
  dialog.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).closest('form[data-guard-discard]'))
      dialog.dataset.dirty = 'true';
  });
  dialog.addEventListener('click', (e) => {
    if (
      (e.target as HTMLElement).closest(
        '#add-file, #add-step, [data-remove], [data-up], [data-down], .remove-file',
      )
    )
      dialog.dataset.dirty = 'true';
  });
  dialog.querySelector('[data-close]')!.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const m = e as MouseEvent;
      if (m.clientX < r.left || m.clientX > r.right || m.clientY < r.top || m.clientY > r.bottom)
        requestClose();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (!document.querySelector('dialog[open]'))
      document.documentElement.classList.remove('has-modal');
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
  });
  decorate();
  dialog.showModal();
  document.documentElement.classList.add('has-modal');
  return dialog;
}
export async function busy(button: HTMLButtonElement, job: () => Promise<void>) {
  const text = button.innerHTML;
  button.disabled = true;
  button.textContent = 'در حال انجام…';
  try {
    await job();
  } catch (e) {
    handleError(e);
  } finally {
    button.disabled = false;
    button.innerHTML = text;
    decorate();
  }
}
export const empty = (title: string, subtitle: string, symbol = 'package-open') =>
  `<div class="empty">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>`;
export const field = (label: string, input: string) =>
  `<label class="field"><span>${label}</span>${input}</label>`;
