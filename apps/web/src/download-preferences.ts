import { native, invoke } from './device';
import { esc, fa, size, busy, modal, toast, handleError } from './ui';
export async function downloadPreferences(el: HTMLElement) {
  if (!native) return;
  const s = await invoke<{ download_path: string; parallel_downloads: number }>('get_settings');
  if (!el.isConnected) return;
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = `<h2>دانلود و فایل موقت</h2><p class="muted">فایل‌های ناقص و تأییدشده با کلید SHA-256 نگهداری می‌شوند. با تلاش مجدد از ادامه پشتیبانی‌شده توسط میزبان استفاده خواهد شد.</p><label>پوشه دانلود<input id="download-path" dir="ltr" readonly value="${esc(s.download_path)}" placeholder="پیش‌فرض: .uhm/download-cache داخل بازی"></label><div class="actions"><button class="button secondary" id="pick-download-dir">انتخاب پوشه</button><button class="text-button" id="default-download-dir">مسیر پیش‌فرض</button></div><label class="setting-row"><span>تعداد دریافت هم‌زمان فایل‌ها در هر پکیج</span><select id="download-parallel">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === s.parallel_downloads ? 'selected' : ''}>${fa(n)}</option>`).join('')}</select></label><button class="button" id="save-download-settings">ذخیره تنظیمات دانلود</button><p class="muted">استخراج و بکاپ در .uhm/transactions بازی می‌ماند تا جایگزینی اتمیک روی همان درایو تضمین شود. هیچ EXE دانلودشده‌ای اجرا نمی‌شود.</p><div id="cache-usage"></div>`;
  el.append(section);
  const path = section.querySelector<HTMLInputElement>('#download-path')!;
  section.querySelector<HTMLButtonElement>('#pick-download-dir')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, multiple: false, title: 'محل نگهداری دانلودها' });
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
        `<p>${fa(cache.files)} فایل موقت / ${size(cache.bytes)}</p><code dir="ltr">${esc(cache.path)}</code><br><button class="text-button" id="clear-download-cache">پاک‌سازی فایل‌های دانلود موقت</button>`;
      section.querySelector<HTMLButtonElement>('#clear-download-cache')!.onclick = () => {
        const d = modal(
          'تأیید پاک‌سازی دانلودها',
          '<p>فایل‌های کامل و ناقص کش پاک می‌شوند و ادامه آن‌ها دیگر ممکن نیست. فایل‌های بازی، بکاپ‌ها و قرنطینه دست‌نخورده می‌مانند.</p><button class="button" id="clear-cache-confirm">پاک‌سازی</button>',
        );
        d.querySelector<HTMLButtonElement>('#clear-cache-confirm')!.onclick = function () {
          void busy(this as HTMLButtonElement, async () => {
            await invoke('download_cache_status', { clear: true });
            d.close();
            toast('کش دانلود پاک شد.');
            await usage();
          });
        };
      };
    } catch {
      section.querySelector('#cache-usage')!.textContent =
        'نمایش کش پس از انتخاب بازی و در نبود عملیات فعال ممکن است.';
    }
  };
  section.querySelector<HTMLButtonElement>('#save-download-settings')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      await invoke('set_download_preferences', {
        path: path.value,
        parallel: Number(section.querySelector<HTMLSelectElement>('#download-parallel')!.value),
      });
      toast('تنظیمات دانلود ذخیره شد.');
      await usage();
    });
  };
  await usage();
}
