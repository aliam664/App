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
export const decorate = () => createIcons({ icons, attrs: { 'stroke-width': 1.6 } });
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
  const el = document.createElement('div');
  el.className = `toast ${danger ? 'danger' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 6500);
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
  dialog.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-button" data-close aria-label="بستن">${icon('x')}</button></div><div class="modal-body">${content}</div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const m = e as MouseEvent;
      if (m.clientX < r.left || m.clientX > r.right || m.clientY < r.top || m.clientY > r.bottom)
        dialog.close();
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  decorate();
  dialog.showModal();
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
