import { invoke, native } from './device';
import { L, fmtDateTime, num } from './i18n';
import { esc, icon, size, modal, busy, toast, empty, decorate, handleError } from './ui';
import {
  type LocalItem,
  type Snapshot,
  kindLabels,
  originLabels,
  text,
  localName,
  filterLocal,
} from './library-model';

let currentObserver: IntersectionObserver | undefined;

export async function localLibrary(el: HTMLElement, force = false) {
  currentObserver?.disconnect();
  el.innerHTML = `<div class="page-title"><h1>${L('کتابخانه من', 'My Library')}</h1></div>${empty(L('خواندن کتابخانه واقعی', 'Reading Local Content'), L('فایل‌های بازی و محتوای نصب‌شده خارج از لانچر بررسی می‌شوند.', 'Scanning game files and externally installed mods.'), 'folder-search')}`;
  if (!native) {
    el.innerHTML = empty(
      L('کتابخانه محلی در نسخه ویندوز', 'Local Library on Windows Desktop'),
      L(
        'مرورگر به فایل‌های بازی دسترسی ندارد؛ کاتالوگ آنلاین با کتابخانه محلی متفاوت است.',
        'Web browsers cannot inspect local game directories; install via the Windows desktop client.',
      ),
      'monitor',
    );
    return;
  }
  let snapshot: Snapshot;
  try {
    snapshot = await invoke<Snapshot>('scan_content', { force });
  } catch (e) {
    el.innerHTML = empty(
      L('اسکن انجام نشد', 'Scan Failed'),
      L(
        'مسیر معتبر بازی را در تنظیمات کتابخانه انتخاب کنید.',
        'Select a valid Assetto Corsa directory in Library Settings.',
      ),
      'folder-x',
    );
    handleError(e);
    return;
  }
  if (!el.isConnected) return;
  const kLabels = kindLabels();
  const oLabels = originLabels();
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>LOCAL CONTENT</p><h1>${L('کتابخانه من', 'My Library')}</h1><p class="muted">${num(snapshot.items.length)} ${L('مورد', 'items')} · ${size(snapshot.bytes)} ${L('مجموع ماشین‌ها و پیست‌ها، بدون دوباره‌شماری اسکین/لی‌اوت', 'total cars & tracks (excluding duplicate skin/layout counts)')}${snapshot.warnings.length ? L(' · اسکن ناقص: حجم فقط بخش قابل خواندن است', ' · Partial scan: readable files only') : ''}</p></div><button id="rescan-content" class="button secondary">${icon('refresh-cw')}${L('اسکن مجدد', 'Rescan')}</button></div><div class="catalog-search"><label class="search">${icon('search')}<input id="local-query" aria-label="${L('جست‌وجوی کتابخانه', 'Search library')}" placeholder="${L('نام، برند، کشور، سازنده یا پوشه', 'Name, brand, country, author, or folder')}"></label><select id="local-kind" aria-label="${L('نوع محتوا', 'Content kind')}"><option value="all">${L('همه نوع‌ها', 'All types')}</option>${Object.entries(
    kLabels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      '',
    )}</select><select id="local-origin" aria-label="${L('منبع محتوا', 'Source origin')}"><option value="all">${L('همه منبع‌ها', 'All sources')}</option>${Object.entries(
    oLabels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      '',
    )}</select><select id="local-sort" aria-label="${L('مرتب‌سازی', 'Sort by')}"><option value="name">${L('نام', 'Name')}</option><option value="size">${L('حجم', 'Size')}</option><option value="brand">${L('برند', 'Brand')}</option></select></div>${snapshot.warnings.length ? `<details class="notice error"><summary>${L('اسکن ناقص:', 'Partial scan warnings:')} ${num(snapshot.warnings.length)} ${L('هشدار', 'warnings')}</summary>${snapshot.warnings.map(esc).join('<br>')}</details>` : ''}<div id="local-items"></div><section class="panel"><h2>${L('نصب‌های ثبت‌شده لانچر', 'Launcher-Tracked Installations')}</h2><p class="muted">${L('این بخش وجود فایل‌ها را بررسی می‌کند؛ سالم بودن بایت‌به‌بایت محتوای خارجی بدون hash مرجع نامشخص است.', 'Checks installed manifest presence; third-party files without reference checksums cannot be byte-verified.')}</p>${snapshot.packages.length ? snapshot.packages.map((p) => `<div class="setting-row"><code dir="ltr">${esc(p.id)} / v${esc(p.version)}</code><span>${num(p.files)} ${L('فایل', 'files')} · ${p.missing ? `${num(p.missing)} ${L('فایل مفقود / نیازمند بررسی', 'missing files')}` : L('همه مسیرها موجودند', 'All paths present')}</span></div>`).join('') : `<p>${L('نصب ثبت‌شده‌ای وجود ندارد؛ موارد بالا ممکن است با روش دیگری نصب شده باشند.', 'No launcher-tracked packages yet; detected folders may be external installations.')}</p>`}</section><small class="muted">${L('آخرین اسکن:', 'Last scan:')} ${fmtDateTime(new Date(snapshot.scanned_at * 1000))}</small>`;
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
      ? `<div class="package-grid">${matches.map((i) => `<article class="package-card local-content-card"><button class="card-image" data-local="${esc(i.id)}" aria-label="${L('جزئیات', 'Details for')} ${esc(localName(i))}">${i.image ? `<img data-local-image="${esc(i.image)}" alt="${L('تصویر محلی', 'Local preview')}" loading="lazy">` : icon('image-off')}<span class="installed-tag">${esc(kLabels[i.kind as keyof typeof kLabels] || i.kind)}</span></button><div class="card-content"><button class="card-title" data-local="${esc(i.id)}">${esc(localName(i))}</button><code dir="ltr">${esc(i.path.split('/').at(-1)!)}</code><p>${esc(text(i.metadata.brand))} · ${esc(text(i.metadata.country))}</p><div class="card-footer"><span>${i.kind === 'layout' ? L('حجم مستقل نامشخص', 'Shared track size') : size(i.bytes)}</span><span>${esc(oLabels[i.source as keyof typeof oLabels] || i.source)}</span></div>${i.warnings.length ? `<small class="muted">${L('متادیتا ناقص یا خطای خواندن', 'Incomplete metadata')} (${num(i.warnings.length)})</small>` : ''}</div></article>`).join('')}</div>`
      : empty(
          L('محتوایی پیدا نشد', 'No matching local items'),
          L(
            'فیلترها یا مسیر بازی را بررسی کنید.',
            'Adjust search filters or verify your game path.',
          ),
          'search-x',
        );
    el.querySelectorAll<HTMLButtonElement>('[data-local]').forEach(
      (b) =>
        (b.onclick = () =>
          localDetails(
            matches.find((i) => i.id === b.dataset.local)!,
            () => localLibrary(el, true),
          )),
    );
    currentObserver?.disconnect();
    const observer = (currentObserver = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        const image = entry.target as HTMLImageElement;
        void invoke<string>('content_image', { path: image.dataset.localImage })
          .then((src) => {
            if (image.isConnected) image.src = src;
          })
          .catch(() => {
            image.alt = L('تصویر قابل خواندن نیست', 'Preview unreadable');
          });
      }),
    ));
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
  const kLabels = kindLabels();
  const oLabels = originLabels();
  const d = modal(
    L('جزئیات محتوای محلی', 'Local Item Details'),
    `<h3>${esc(localName(item))}</h3><p class="preserve">${esc(text(item.metadata.description))}</p><dl class="definition"><dt>${L('مسیر', 'Path')}</dt><dd><code dir="ltr">${esc(item.path)}</code></dd><dt>${L('نوع / منبع', 'Kind / Source')}</dt><dd>${esc(kLabels[item.kind as keyof typeof kLabels] || item.kind)} / ${esc(oLabels[item.source as keyof typeof oLabels] || item.source)}</dd>${['brand', 'author', 'country', 'version', 'tags'].map((k) => `<dt>${esc(({ brand: L('برند', 'Brand'), author: L('سازنده', 'Author'), country: L('کشور', 'Country'), version: L('نسخه', 'Version'), tags: L('برچسب‌ها', 'Tags') } as Record<string, string>)[k])}</dt><dd>${esc(Array.isArray(item.metadata[k]) ? (item.metadata[k] as unknown[]).map(text).join(', ') : text(item.metadata[k]))}</dd>`).join('')}<dt>${L('فایل / حجم پوشه', 'Files / Folder size')}</dt><dd>${num(item.files)} / ${size(item.bytes)}</dd></dl>${item.warnings.length ? `<div class="notice">${item.warnings.map(esc).join('<br>')}</div>` : ''}${item.kind === 'layout' ? `<p class="notice">${L('این رکورد متادیتای لی‌اوت است؛ مدل‌ها با پیست مشترک‌اند. حذف مستقل لی‌اوت در این مرحله ارائه نمی‌شود.', 'Layout metadata shares track models; standalone layout quarantine is disabled.')}</p>` : `<button class="button secondary" id="preview-delete">${L('بررسی فایل‌ها برای انتقال به قرنطینه', 'Inspect Files for Quarantine')}</button>`}`,
    true,
  );
  d.querySelector<HTMLButtonElement>('#preview-delete')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      const preview = await invoke<{
        id: string;
        files: { path: string; bytes: number; external: boolean }[];
      }>('deletion_preview', { path: item.path });
      const confirm = modal(
        L('تأیید انتقال فایل‌ها', 'Confirm Quarantine Move'),
        `<p class="notice error">${L('محتوای خارجی ممکن است متعلق به Steam، Content Manager یا نصب دستی باشد. فقط فایل‌های انتخاب‌شده منتقل می‌شوند؛ هیچ فایل اصلی بازی به‌صورت خودکار حذف نمی‌شود. این عملیات فضای دیسک آزاد نمی‌کند و قابل بازیابی است.', 'External files may belong to Steam or manual installs. Only checked files are moved to recoverable quarantine without freeing disk space automatically.')}</p><label class="setting-row"><span>${L('مسئولیت انتقال فایل‌های خارجی را می‌پذیرم', 'I acknowledge moving externally managed files')}</span><input id="ack-external" type="checkbox"></label><div class="file-preview-list">${preview.files.map((f) => `<label class="setting-row"><input type="checkbox" data-delete-file value="${esc(f.path)}" checked><code dir="ltr">${esc(f.path)}</code><small>${size(f.bytes)} / ${f.external ? L('خارجی', 'External') : L('لانچر', 'Launcher')}</small></label>`).join('')}</div><div class="actions"><button class="button" id="confirm-delete">${L('انتقال انتخاب‌ها به قرنطینه', 'Move Checked to Quarantine')}</button><button class="button secondary" id="cancel-delete">${L('انصراف', 'Cancel')}</button></div>`,
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
          toast(
            L(
              'فایل‌ها به قرنطینه منتقل شدند؛ بازیابی از تنظیمات کتابخانه.',
              'Moved to quarantine; restore anytime in Library Settings.',
            ),
          );
          await refresh();
        });
      };
    });
  });
}

export async function libraryPreferences(el: HTMLElement, onPath: (path: string) => void) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>LIBRARY SETTINGS</p><h1>${L('تنظیمات کتابخانه', 'Library Settings')}</h1><p class="muted">${L('کشف مسیر نصب بازی، اسکن خودکار و بازیابی فایل‌های قرنطینه.', 'Detect Steam/Assetto Corsa paths, toggle auto-scanning, and recover quarantined files.')}</p></div></div>${!native ? empty(L('نیازمند نسخه ویندوز', 'Windows Desktop Required'), L('کشف و انتخاب پوشه‌ها در مرورگر انجام نمی‌شود.', 'Path discovery and local directory quarantine operate only in the Windows desktop app.'), 'monitor') : `<section class="panel"><div class="actions"><button class="button" id="discover-paths">${L('کشف Steam و نصب‌های بازی', 'Detect Steam & AC Installs')}</button><button class="button secondary" id="manual-game">${L('انتخاب دستی بازی', 'Choose Game Folder')}</button></div><div id="detected-paths"></div><label class="setting-row"><span>${L('اسکن خودکار هنگام نمایش کتابخانه (هر ۶۰ ثانیه)', 'Auto-rescan library every 60s when open')}</span><input type="checkbox" id="autoscan-content"></label></section><section class="panel"><h2>${L('بازیابی قرنطینه', 'Quarantine Recovery')}</h2><div id="recovery-list"></div></section>`}`;
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
    toast(L('مسیر معتبر ذخیره شد.', 'Verified game path saved.'));
  };
  el.querySelector<HTMLButtonElement>('#manual-game')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const p = await open({ directory: true, multiple: false, title: 'Assetto Corsa' });
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
      target.innerHTML = `<h3>${L('نصب‌های معتبر', 'Valid Installs')}</h3>${result.games.length ? result.games.map((p) => `<div class="path-box"><code dir="ltr">${esc(p)}</code><button class="button secondary" data-game-path="${esc(p)}">${L('انتخاب', 'Select')}</button></div>`).join('') : `<p>${L('نصبی کشف نشد؛ انتخاب دستی در دسترس است.', 'No installation auto-detected; choose manually.')}</p>`}<dl class="definition">${[
        ['Steam', result.steam_libraries],
        ['Documents', result.documents],
        ['Content Manager', result.content_managers],
        [
          L('داده Content Manager', 'Content Manager Data'),
          result.content_manager_data ? [result.content_manager_data] : [],
        ],
      ]
        .map(
          ([label, paths]) =>
            `<dt>${esc(label as string)}</dt><dd dir="ltr">${(paths as string[]).map(esc).join('<br>') || L('نامشخص', 'Unknown')}</dd>`,
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
              `<div class="setting-row"><span>${num(r.files)} ${L('فایل', 'files')} · ${fmtDateTime(new Date(r.created_at * 1000))} · ${esc(r.state)}</span><button class="button secondary" data-restore="${r.id}">${L('بازیابی بدون جایگزینی', 'Restore without overwrite')}</button></div>`,
          )
          .join('')
      : `<p class="muted">${L('فایلی در قرنطینه نیست.', 'No files in quarantine.')}</p>`;
    el.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach(
      (b) =>
        (b.onclick = () => {
          const d = modal(
            L('تأیید بازیابی', 'Confirm Restore'),
            `<p>${L('فایل‌ها به مسیر قبلی برمی‌گردند. در صورت تداخل هیچ فایل جدیدی جایگزین نمی‌شود.', 'Files return to their original paths without overwriting newer files on conflict.')}</p><button class="button" id="restore-confirm">${L('بازیابی', 'Restore')}</button>`,
          );
          d.querySelector<HTMLButtonElement>('#restore-confirm')!.onclick = function () {
            void busy(this as HTMLButtonElement, async () => {
              await invoke('restore_quarantine', { id: b.dataset.restore });
              d.close();
              toast(L('بازیابی انجام شد.', 'Quarantine restored.'));
              await recovery();
            });
          };
        }),
    );
  };
  try {
    await recovery();
  } catch {
    el.querySelector('#recovery-list')!.textContent = L(
      'ابتدا مسیر معتبر بازی را انتخاب کنید؛ سپس این صفحه را دوباره باز کنید.',
      'Select a valid game directory first, then reopen this view.',
    );
  }
}
