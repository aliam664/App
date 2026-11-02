import { invoke, native } from './device';
import { esc, icon, size, fa, modal, busy, toast, empty, decorate, handleError } from './ui';
export type LocalItem = {
  id: string;
  kind: string;
  parent: string | null;
  path: string;
  metadata: Record<string, unknown>;
  bytes: number;
  files: number;
  image: string | null;
  source: string;
  warnings: string[];
};
type Snapshot = { items: LocalItem[]; bytes: number; scanned_at: number; warnings: string[] };
const kinds: Record<string, string> = {
  car: 'ماشین',
  track: 'پیست',
  skin: 'اسکین',
  layout: 'لی‌اوت',
};
const origins: Record<string, string> = {
  external: 'خارج از لانچر',
  launcher: 'لانچر',
  mixed: 'ترکیبی',
};
const text = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : 'نامشخص';
export const localName = (i: LocalItem) => text(i.metadata.name ?? i.metadata.skinname);
export function filterLocal(
  items: LocalItem[],
  query: string,
  kind: string,
  origin: string,
  sort: string,
): LocalItem[] {
  const q = query.trim().toLocaleLowerCase();
  return items
    .filter(
      (i) =>
        (kind === 'all' || i.kind === kind) &&
        (origin === 'all' || i.source === origin) &&
        `${i.path} ${Object.values(i.metadata).flat().join(' ')}`.toLocaleLowerCase().includes(q),
    )
    .sort((a, b) =>
      sort === 'size'
        ? b.bytes - a.bytes
        : sort === 'brand'
          ? text(a.metadata.brand).localeCompare(text(b.metadata.brand))
          : localName(a).localeCompare(localName(b)),
    );
}
export async function localLibrary(el: HTMLElement, force = false) {
  el.innerHTML = `<div class="page-title"><h1>کتابخانه من</h1></div>${empty('خواندن کتابخانه واقعی', 'فایل‌های بازی و محتوای نصب‌شده خارج از لانچر بررسی می‌شوند.', 'folder-search')}`;
  if (!native) {
    el.innerHTML = empty(
      'کتابخانه محلی در نسخه ویندوز',
      'مرورگر به فایل‌های بازی دسترسی ندارد؛ کاتالوگ آنلاین با کتابخانه محلی متفاوت است.',
      'monitor',
    );
    return;
  }
  let snapshot: Snapshot;
  try {
    snapshot = await invoke<Snapshot>('scan_content', { force });
  } catch (e) {
    el.innerHTML = empty(
      'اسکن انجام نشد',
      'مسیر معتبر بازی را در تنظیمات کتابخانه انتخاب کنید.',
      'folder-x',
    );
    handleError(e);
    return;
  }
  if (!el.isConnected) return;
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">LOCAL CONTENT</p><h1>کتابخانه من</h1><p class="muted">${fa(snapshot.items.length)} مورد · ${size(snapshot.bytes)} مجموع ماشین‌ها و پیست‌ها، بدون دوباره‌شماری اسکین/لی‌اوت</p></div><button id="rescan-content" class="button secondary">${icon('refresh-cw')}اسکن مجدد</button></div><div class="catalog-search"><label class="search">${icon('search')}<input id="local-query" aria-label="جست‌وجوی کتابخانه" placeholder="نام، برند، کشور، سازنده یا پوشه"></label><select id="local-kind" aria-label="نوع محتوا"><option value="all">همه نوع‌ها</option>${Object.entries(
    kinds,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      '',
    )}</select><select id="local-origin" aria-label="منبع محتوا"><option value="all">همه منبع‌ها</option>${Object.entries(
    origins,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      '',
    )}</select><select id="local-sort" aria-label="مرتب‌سازی"><option value="name">نام</option><option value="size">حجم</option><option value="brand">برند</option></select></div>${snapshot.warnings.length ? `<details class="notice error"><summary>اسکن ناقص: ${fa(snapshot.warnings.length)} هشدار</summary>${snapshot.warnings.map(esc).join('<br>')}</details>` : ''}<div id="local-items"></div><small class="muted">آخرین اسکن: ${new Date(snapshot.scanned_at * 1000).toLocaleString('fa-IR')} · کش حداکثر ۶۰ ثانیه. حجم لی‌اوت مستقل نامشخص است؛ مدل‌های پیست مشترک‌اند.</small>`;
  const list = () => {
    const get = (id: string) => (el.querySelector('#' + id) as HTMLInputElement).value;
    const matches = filterLocal(
      snapshot.items,
      get('local-query'),
      get('local-kind'),
      get('local-origin'),
      get('local-sort'),
    );
    el.querySelector('#local-items')!.innerHTML = matches.length
      ? `<div class="package-grid">${matches.map((i) => `<article class="package-card local-content-card"><button class="card-image" data-local="${esc(i.id)}" aria-label="جزئیات ${esc(localName(i))}">${i.image ? `<img data-local-image="${esc(i.image)}" alt="تصویر محلی" loading="lazy">` : icon('image-off')}<span class="installed-tag">${esc(kinds[i.kind])}</span></button><div class="card-content"><button class="card-title" data-local="${esc(i.id)}">${esc(localName(i))}</button><code dir="ltr">${esc(i.path.split('/').at(-1)!)}</code><p>${esc(text(i.metadata.brand))} · ${esc(text(i.metadata.country))}</p><div class="card-footer"><span>${i.kind === 'layout' ? 'حجم مستقل نامشخص' : size(i.bytes)}</span><span>${esc(origins[i.source])}</span></div>${i.warnings.length ? `<small class="muted">متادیتا ناقص یا خطای خواندن (${fa(i.warnings.length)})</small>` : ''}</div></article>`).join('')}</div>`
      : empty('محتوایی پیدا نشد', 'فیلترها یا مسیر بازی را بررسی کنید.', 'search-x');
    el.querySelectorAll<HTMLButtonElement>('[data-local]').forEach(
      (b) =>
        (b.onclick = () =>
          localDetails(
            matches.find((i) => i.id === b.dataset.local)!,
            () => localLibrary(el, true),
          )),
    );
    const observer = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        const image = entry.target as HTMLImageElement;
        void invoke<string>('content_image', { path: image.dataset.localImage })
          .then((src) => {
            if (image.isConnected) image.src = src;
          })
          .catch(() => {
            image.alt = 'تصویر قابل خواندن نیست';
          });
      }),
    );
    el.querySelectorAll('[data-local-image]').forEach((img) => observer.observe(img));
    decorate();
  };
  for (const id of ['local-query', 'local-kind', 'local-origin', 'local-sort'])
    el.querySelector('#' + id)!.addEventListener(id === 'local-query' ? 'input' : 'change', list);
  el.querySelector<HTMLButtonElement>('#rescan-content')!.onclick = function () {
    void busy(this as HTMLButtonElement, () => localLibrary(el, true));
  };
  list();
}
function localDetails(item: LocalItem, refresh: () => Promise<void>) {
  const d = modal(
    'جزئیات محتوای محلی',
    `<h3>${esc(localName(item))}</h3><p class="preserve">${esc(text(item.metadata.description))}</p><dl class="definition"><dt>مسیر</dt><dd><code dir="ltr">${esc(item.path)}</code></dd><dt>نوع / منبع</dt><dd>${esc(kinds[item.kind])} / ${esc(origins[item.source])}</dd>${['brand', 'author', 'country', 'version', 'tags'].map((k) => `<dt>${esc(({ brand: 'برند', author: 'سازنده', country: 'کشور', version: 'نسخه', tags: 'برچسب‌ها' } as Record<string, string>)[k])}</dt><dd>${esc(Array.isArray(item.metadata[k]) ? (item.metadata[k] as unknown[]).map(text).join('، ') : text(item.metadata[k]))}</dd>`).join('')}<dt>فایل / حجم پوشه</dt><dd>${fa(item.files)} / ${size(item.bytes)}</dd></dl>${item.warnings.length ? `<div class="notice">${item.warnings.map(esc).join('<br>')}</div>` : ''}${item.kind === 'layout' ? '<p class="notice">این رکورد متادیتای لی‌اوت است؛ مدل‌ها با پیست مشترک‌اند. حذف مستقل لی‌اوت در این مرحله ارائه نمی‌شود.</p>' : '<button class="button secondary" id="preview-delete">بررسی فایل‌ها برای انتقال به قرنطینه</button>'}`,
    true,
  );
  d.querySelector<HTMLButtonElement>('#preview-delete')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      const preview = await invoke<{
        id: string;
        files: { path: string; bytes: number; external: boolean }[];
      }>('deletion_preview', { path: item.path });
      const confirm = modal(
        'تأیید انتقال فایل‌ها',
        `<p class="notice error">محتوای خارجی ممکن است متعلق به Steam، Content Manager یا نصب دستی باشد. فقط فایل‌های انتخاب‌شده منتقل می‌شوند؛ هیچ فایل اصلی بازی به‌صورت خودکار حذف نمی‌شود. این عملیات فضای دیسک آزاد نمی‌کند و قابل بازیابی است.</p><label><input id="ack-external" type="checkbox"> مسئولیت انتقال فایل‌های خارجی را می‌پذیرم</label><div class="file-preview-list">${preview.files.map((f) => `<label class="setting-row"><input type="checkbox" data-delete-file value="${esc(f.path)}" checked><code dir="ltr">${esc(f.path)}</code><small>${size(f.bytes)} / ${f.external ? 'خارجی' : 'لانچر'}</small></label>`).join('')}</div><div class="actions"><button class="button" id="confirm-delete">انتقال انتخاب‌ها به قرنطینه</button><button class="button secondary" id="cancel-delete">انصراف</button></div>`,
        true,
      );
      confirm.querySelector('#cancel-delete')!.addEventListener('click', () => confirm.close());
      confirm.querySelector<HTMLButtonElement>('#confirm-delete')!.onclick = function () {
        void busy(this as HTMLButtonElement, async () => {
          const selected = [
            ...confirm.querySelectorAll<HTMLInputElement>('[data-delete-file]:checked'),
          ].map((i) => i.value);
          await invoke('quarantine_files', {
            id: preview.id,
            selected,
            acknowledgeExternal: (confirm.querySelector('#ack-external') as HTMLInputElement)
              .checked,
          });
          confirm.close();
          d.close();
          toast('فایل‌ها به قرنطینه منتقل شدند؛ بازیابی از تنظیمات کتابخانه.');
          await refresh();
        });
      };
    });
  });
}
export async function libraryPreferences(el: HTMLElement, onPath: (path: string) => void) {
  el.innerHTML = `<div class="page-title"><h1>تنظیمات کتابخانه</h1></div>${!native ? empty('نیازمند نسخه ویندوز', 'کشف و انتخاب پوشه‌ها در مرورگر انجام نمی‌شود.', 'monitor') : '<section class="panel"><button class="button" id="discover-paths">کشف Steam و نصب‌های بازی</button><button class="button secondary" id="manual-game">انتخاب دستی بازی</button><div id="detected-paths"></div><label class="setting-row"><span>اسکن خودکار هنگام نمایش کتابخانه (هر ۶۰ ثانیه)</span><input type="checkbox" id="autoscan-content"></label></section><section class="panel"><h2>بازیابی قرنطینه</h2><div id="recovery-list"></div></section>'}`;
  if (!native) return;
  const settings = await invoke<{ game_path: string; autoscan: boolean }>('get_settings');
  (el.querySelector('#autoscan-content') as HTMLInputElement).checked = settings.autoscan;
  el.querySelector('#autoscan-content')!.addEventListener('change', (e) => {
    void invoke('set_autoscan', { enabled: (e.target as HTMLInputElement).checked }).catch(
      handleError,
    );
  });
  const select = async (path: string) => {
    const r = await invoke<{ path: string }>('set_game_path', { path });
    onPath(r.path);
    toast('مسیر معتبر ذخیره شد.');
  };
  el.querySelector<HTMLButtonElement>('#manual-game')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const p = await open({ directory: true, multiple: false, title: 'پوشه Assetto Corsa' });
      if (typeof p === 'string') await select(p);
    });
  };
  el.querySelector<HTMLButtonElement>('#discover-paths')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      const result = await invoke<{
        games: string[];
        documents: string[];
        content_managers: string[];
        content_manager_data: string | null;
        steam_libraries: string[];
      }>('discover_paths');
      const target = el.querySelector('#detected-paths')!;
      target.innerHTML = `<h3>نصب‌های معتبر</h3>${result.games.length ? result.games.map((p) => `<div class="path-box"><code dir="ltr">${esc(p)}</code><button class="button secondary" data-game-path="${esc(p)}">انتخاب</button></div>`).join('') : '<p>نصبی کشف نشد؛ انتخاب دستی در دسترس است.</p>'}<dl class="definition">${[
        ['Steam', result.steam_libraries],
        ['Documents', result.documents],
        ['Content Manager', result.content_managers],
        ['داده Content Manager', result.content_manager_data ? [result.content_manager_data] : []],
      ]
        .map(
          ([label, paths]) =>
            `<dt>${esc(label as string)}</dt><dd dir="ltr">${(paths as string[]).map(esc).join('<br>') || 'نامشخص'}</dd>`,
        )
        .join('')}</dl>`;
      target.querySelectorAll<HTMLButtonElement>('[data-game-path]').forEach(
        (b) =>
          (b.onclick = () => {
            void busy(b, () => select(b.dataset.gamePath!));
          }),
      );
    });
  };
  const recovery = async () => {
    const rows =
      await invoke<{ id: string; state: string; created_at: number; files: number }[]>(
        'list_quarantine',
      );
    el.querySelector('#recovery-list')!.innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<div class="setting-row"><span>${fa(r.files)} فایل · ${new Date(r.created_at * 1000).toLocaleString('fa-IR')} · ${esc(r.state)}</span><button class="button secondary" data-restore="${r.id}">بازیابی بدون جایگزینی</button></div>`,
          )
          .join('')
      : '<p class="muted">فایلی در قرنطینه نیست.</p>';
    el.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach(
      (b) =>
        (b.onclick = () => {
          const d = modal(
            'تأیید بازیابی',
            '<p>فایل‌ها به مسیر قبلی برمی‌گردند. در صورت تداخل هیچ فایل جدیدی جایگزین نمی‌شود.</p><button class="button" id="restore-confirm">بازیابی</button>',
          );
          d.querySelector<HTMLButtonElement>('#restore-confirm')!.onclick = function () {
            void busy(this as HTMLButtonElement, async () => {
              await invoke('restore_quarantine', { id: b.dataset.restore });
              d.close();
              toast('بازیابی انجام شد.');
              await recovery();
            });
          };
        }),
    );
  };
  try {
    await recovery();
  } catch {
    el.querySelector('#recovery-list')!.textContent =
      'ابتدا مسیر معتبر بازی را انتخاب کنید؛ سپس این صفحه را دوباره باز کنید.';
  }
}
