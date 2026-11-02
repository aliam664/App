import { native, invoke } from './device';
import { size } from './ui';
export type UpdateStatus = {
  phase: string;
  current_version: string;
  available_version: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
};
export function updateStatusText(s: UpdateStatus): string {
  const version = s.available_version ? `نسخه ${s.available_version}` : 'آپدیت';
  switch (s.phase) {
    case 'idle':
      return 'بررسی خودکار آپدیت در شروع برنامه انجام می‌شود.';
    case 'checking':
      return 'در حال بررسی انتشار امضاشده…';
    case 'downloading':
      return `دریافت ${version}: ${size(s.downloaded)}${s.total ? ` از ${size(s.total)}` : ''}`;
    case 'ready':
      return `${version} دریافت و امضایش تأیید شد؛ هنگام خروج یا اجرای بعدی، پس از بسته‌شدن بازی و پایان عملیات محتوا نصب می‌شود.`;
    case 'installing':
      return 'در حال اجرای نصب‌کننده امضاشده لانچر…';
    case 'current':
      return `نسخه ${s.current_version} به‌روز است.`;
    default:
      if (s.error?.includes('Insufficient space'))
        return 'فضای کافی برای آپدیت لانچر وجود ندارد؛ پس از آزادکردن فضا دوباره تلاش می‌شود.';
      if (s.error?.includes('signature') || s.error?.includes('signed version'))
        return 'اعتبار امضا یا نسخه آپدیت تأیید نشد؛ فایل نصب نمی‌شود.';
      return 'بررسی یا دریافت آپدیت ممکن نشد؛ برنامه بعداً خودکار تلاش می‌کند.';
  }
}
export async function updateStatusPanel(el: HTMLElement) {
  if (!native || !el.isConnected) return;
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML =
    '<h2>به‌روزرسانی خودکار لانچر</h2><p role="status"></p><p class="muted">دریافت پس‌زمینه و نصب در خروج یا اجرای بعدی؛ فقط فایل دارای امضای معتبر و نسخه جدیدتر پذیرفته می‌شود. اطلاعات لایسنس و بازی حفظ می‌شوند.</p>';
  el.append(section);
  const render = async () => {
    if (!section.isConnected) return;
    try {
      const s = await invoke<UpdateStatus>('updater_status');
      if (section.isConnected) section.querySelector('p')!.textContent = updateStatusText(s);
    } catch {
      section.querySelector('p')!.textContent = 'خواندن وضعیت آپدیت ممکن نشد.';
    }
    if (section.isConnected) setTimeout(() => void render(), 3000);
  };
  await render();
}
