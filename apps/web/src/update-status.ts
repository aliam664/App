import { native, invoke } from './device';
import { L, getLang } from './i18n';
import { size, busy, toast } from './ui';

export type UpdateStatus = {
  phase: string;
  current_version: string;
  available_version: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
};

export function updateStatusText(s: UpdateStatus, lang = getLang()): string {
  const version = s.available_version
    ? L(`نسخه ${s.available_version}`, `version ${s.available_version}`, lang)
    : L('آپدیت', 'update', lang);
  switch (s.phase) {
    case 'idle':
      return L(
        'بررسی خودکار آپدیت در شروع برنامه انجام می‌شود.',
        'Automatic update checks run at launcher startup.',
        lang,
      );
    case 'checking':
      return L('در حال بررسی انتشار امضاشده…', 'Checking signed release feed…', lang);
    case 'downloading':
      return L(
        `دریافت ${version}: ${size(s.downloaded)}${s.total ? ` از ${size(s.total)}` : ''}`,
        `Downloading ${version}: ${size(s.downloaded)}${s.total ? ` of ${size(s.total)}` : ''}`,
        lang,
      );
    case 'ready':
      return L(
        `${version} دریافت و امضایش تأیید شد؛ هنگام خروج یا اجرای بعدی، پس از بسته‌شدن بازی و پایان عملیات محتوا نصب می‌شود.`,
        `${version} downloaded and signature verified; it will install on exit or next launch once game and content jobs finish.`,
        lang,
      );
    case 'installing':
      return L('در حال اجرای نصب‌کننده امضاشده لانچر…', 'Running signed launcher installer…', lang);
    case 'current':
      return L(
        `نسخه ${s.current_version} به‌روز است.`,
        `Version ${s.current_version} is up to date.`,
        lang,
      );
    default:
      if (s.error?.includes('Insufficient space'))
        return L(
          'فضای کافی برای آپدیت لانچر وجود ندارد؛ پس از آزادکردن فضا دوباره تلاش می‌شود.',
          'Insufficient disk space for launcher update; retry once space is freed.',
          lang,
        );
      if (s.error?.includes('signature') || s.error?.includes('signed version'))
        return L(
          'اعتبار امضا یا نسخه آپدیت تأیید نشد؛ فایل نصب نمی‌شود.',
          'Update signature or version check failed; package rejected.',
          lang,
        );
      return L(
        'بررسی یا دریافت آپدیت ممکن نشد؛ برنامه بعداً خودکار تلاش می‌کند.',
        'Update check or download failed; automatic retry will occur later.',
        lang,
      );
  }
}

export async function updateStatusPanel(el: HTMLElement) {
  if (!native || !el.isConnected) return;
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = `<h2>${L('به‌روزرسانی خودکار لانچر', 'Automatic Launcher Updates')}</h2><p role="status"></p><p class="muted">${L('دریافت پس‌زمینه و نصب در خروج یا اجرای بعدی؛ فقط فایل دارای امضای معتبر و نسخه جدیدتر پذیرفته می‌شود. اطلاعات لایسنس و بازی حفظ می‌شوند.', 'Background fetch with install on exit; only strictly newer, cryptographically signed builds are accepted while preserving your license and game files.')}</p><label class="setting-row"><span>${L('بررسی خودکار هنگام اجرا و هر شش ساعت', 'Check automatically on launch and every 6 hours')}<small class="muted">${L('خاموش‌کردن، دانلود جاری یا نصب امنِ آپدیت آماده را لغو نمی‌کند.', 'Disabling checks does not cancel an in-flight download or verified ready update.')}</small></span><input type="checkbox" id="automatic-update-checks"></label><button type="button" class="button secondary" id="manual-update-check">${L('بررسی دستی نسخه جدید', 'Check for Updates Now')}</button>`;
  el.append(section);
  const automatic = section.querySelector<HTMLInputElement>('#automatic-update-checks')!;
  try {
    automatic.checked = (
      await invoke<{ automatic_checks: boolean }>('updater_preferences')
    ).automatic_checks;
    automatic.onchange = () => {
      automatic.disabled = true;
      void (async () => {
        try {
          await invoke('set_updater_preferences', { automaticChecks: automatic.checked });
          toast(L('تنظیم بررسی خودکار ذخیره شد.', 'Automatic update preference saved.'));
        } catch {
          automatic.checked = !automatic.checked;
          toast(
            L('ذخیره تنظیم بررسی خودکار ممکن نشد.', 'Failed to update check preference.'),
            true,
          );
        } finally {
          automatic.disabled = false;
        }
      })();
    };
  } catch {
    automatic.disabled = true;
  }
  section.querySelector<HTMLButtonElement>('#manual-update-check')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      await invoke('check_launcher_update');
    });
  };
  const render = async () => {
    if (!section.isConnected) return;
    try {
      const s = await invoke<UpdateStatus>('updater_status');
      if (section.isConnected) {
        section.querySelector('p')!.textContent =
          s.phase === 'idle' && !automatic.checked
            ? L(
                'بررسی خودکار غیرفعال است؛ بررسی دستی در دسترس است.',
                'Automatic checks disabled; manual update checks remain available.',
              )
            : updateStatusText(s);
        section.querySelector<HTMLButtonElement>('#manual-update-check')!.disabled = [
          'checking',
          'downloading',
          'installing',
        ].includes(s.phase);
      }
    } catch {
      section.querySelector('p')!.textContent = L(
        'خواندن وضعیت آپدیت ممکن نشد.',
        'Unable to read updater status.',
      );
    }
    if (section.isConnected) setTimeout(() => void render(), 3000);
  };
  await render();
}
