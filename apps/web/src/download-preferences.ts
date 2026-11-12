import { native, invoke } from './device';
import { L, num } from './i18n';
import { esc, size, busy, modal, toast } from './ui';

export async function downloadPreferences(el: HTMLElement) {
  if (!native) return;
  const s = await invoke<{ download_path: string; parallel_downloads: number }>('get_settings');
  if (!el.isConnected) return;
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = `<h2>${L('دانلود و فایل موقت', 'Downloads & Staging Cache')}</h2><p class="muted">${L('فایل‌های ناقص و تأییدشده با کلید SHA-256 نگهداری می‌شوند. با تلاش مجدد از ادامه پشتیبانی‌شده توسط میزبان استفاده خواهد شد.', 'Partial and SHA-256 verified artifacts are retained in local cache for resumable downloads when supported by the host.')}</p><label class="field"><span>${L('پوشه دانلود', 'Download Cache Folder')}</span><input id="download-path" dir="ltr" readonly value="${esc(s.download_path)}" placeholder="${L('پیش‌فرض: .uhm/download-cache داخل بازی', 'Default: .uhm/download-cache inside game folder')}"></label><div class="actions"><button class="button secondary" id="pick-download-dir">${L('انتخاب پوشه', 'Choose Folder')}</button><button class="text-button" id="default-download-dir">${L('مسیر پیش‌فرض', 'Use Default Path')}</button></div><label class="setting-row"><span>${L('تعداد دریافت هم‌زمان فایل‌ها در هر پکیج', 'Concurrent file downloads per package')}</span><select id="download-parallel">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === s.parallel_downloads ? 'selected' : ''}>${num(n)}</option>`).join('')}</select></label><button class="button" id="save-download-settings">${L('ذخیره تنظیمات دانلود', 'Save Download Settings')}</button><p class="muted">${L('استخراج و بکاپ در .uhm/transactions بازی می‌ماند تا جایگزینی اتمیک روی همان درایو تضمین شود. هیچ EXE دانلودشده‌ای اجرا نمی‌شود.', 'Extraction and rollback backups remain in .uhm/transactions inside the game directory for atomic commits. Downloaded EXEs are never executed.')}</p><div id="cache-usage"></div>`;
  el.append(section);
  const path = section.querySelector<HTMLInputElement>('#download-path')!;
  section.querySelector<HTMLButtonElement>('#pick-download-dir')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({
        directory: true,
        multiple: false,
        title: L('محل نگهداری دانلودها', 'Select download cache directory'),
      });
      if (typeof dir === 'string') path.value = dir;
    });
  };
  section.querySelector('#default-download-dir')!.addEventListener('click', () => {
    path.value = '';
  });
  const usage = async () => {
    try {
      const cache = await invoke<{ path: string; bytes: number; files: number }>(
        'download_cache_status',
        { clear: false },
      );
      section.querySelector('#cache-usage')!.innerHTML =
        `<p>${num(cache.files)} ${L('فایل موقت', 'cached files')} / ${size(cache.bytes)}</p><code dir="ltr">${esc(cache.path)}</code><br><button class="text-button" id="clear-download-cache">${L('پاک‌سازی فایل‌های دانلود موقت', 'Clear download cache')}</button>`;
      section.querySelector<HTMLButtonElement>('#clear-download-cache')!.onclick = () => {
        const d = modal(
          L('تأیید پاک‌سازی دانلودها', 'Confirm Cache Cleanup'),
          `<p>${L('فایل‌های کامل و ناقص کش پاک می‌شوند و ادامه آن‌ها دیگر ممکن نیست. فایل‌های بازی، بکاپ‌ها و قرنطینه دست‌نخورده می‌مانند.', 'Partial and completed temporary cache files will be deleted. Game content, backups, and quarantine remain untouched.')}</p><button class="button" id="clear-cache-confirm">${L('پاک‌سازی', 'Clear Cache')}</button>`,
        );
        d.querySelector<HTMLButtonElement>('#clear-cache-confirm')!.onclick = function () {
          void busy(this as HTMLButtonElement, async () => {
            await invoke('download_cache_status', { clear: true });
            d.close();
            toast(L('کش دانلود پاک شد.', 'Download cache cleared.'));
            await usage();
          });
        };
      };
    } catch {
      section.querySelector('#cache-usage')!.textContent = L(
        'نمایش کش پس از انتخاب بازی و در نبود عملیات فعال ممکن است.',
        'Cache inspection becomes available after selecting a game path with no active jobs.',
      );
    }
  };
  section.querySelector<HTMLButtonElement>('#save-download-settings')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      await invoke('set_download_preferences', {
        path: path.value,
        parallel: Number(section.querySelector<HTMLSelectElement>('#download-parallel')!.value),
      });
      toast(L('تنظیمات دانلود ذخیره شد.', 'Download settings saved.'));
      await usage();
    });
  };
  await usage();
}
