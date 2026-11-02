import { licenseProfile, renderConsole } from './admin-console';
import { licenseAdminSession } from './license-admin';
import { localStore, sessionStore } from './storage';
import { proof, native, invoke } from './device';
import {
  hasPermission,
  type Admin,
  type Permission,
  type TelemetryEvent,
  type ServiceSettings,
} from '../../../packages/contracts/src/index';
import { assetUrl } from './runtime';
import { api, supabase, requireContentV2 } from './api';
import {
  esc,
  icon,
  decorate,
  fa,
  date,
  badge,
  category,
  toast,
  handleError,
  modal,
  busy,
  field,
  empty,
} from './ui';
import {
  PackageSpec,
  type License,
  type AuditEvent,
  type InstallReport,
} from '../../../packages/contracts/src/index';
export type Overview = {
  admin: Admin;
  telemetry?: TelemetryEvent[];
  service?: ServiceSettings | null;
  licenses: Omit<License, 'code_hash'>[];
  packages: PackageSpec[];
  events: AuditEvent[];
  reports: InstallReport[];
};
let overview: Overview;
let token = '';
let refreshPage: () => Promise<void>;
const statuses: Record<string, string> = {
  active: 'فعال',
  unused: 'فعال‌نشده',
  suspended: 'معلق',
  revoked: 'لغوشده',
  published: 'منتشرشده',
  draft: 'پیش‌نویس',
  archived: 'بایگانی',
};
const can = (section: string) =>
  hasPermission(
    overview.admin,
    ({ license: 'licenses.create', content: 'content.write' }[section] || section) as Permission,
  );
export async function renderAdmin(
  container: HTMLElement,
  page: string,
  adminToken: string,
  reload: () => Promise<void>,
) {
  token = adminToken;
  refreshPage = reload;
  overview = await api<Overview>('/admin/overview', undefined, token);
  const navPermissions: Record<string, Permission> = {
    licenses: 'licenses.read',
    devices: 'licenses.read',
    packages: 'content.read',
    versions: 'content.read',
    analytics: 'analytics.read',
    errors: 'errors.read',
    team: 'team.manage',
    service: 'service.manage',
    logs: 'audit.read',
  };
  document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((b) => {
    const permission = navPermissions[b.dataset.nav || ''];
    if (permission) b.hidden = !hasPermission(overview.admin, permission);
  });
  if (await renderConsole(container, page, { data: overview, token, reload })) return;
  if (page === 'dashboard') dashboard(container);
  else if (page === 'licenses') licenses(container);
  else if (page === 'versions') await versionsPage(container);
  else if (page === 'packages') packages(container, false);
  else if (page === 'devices') devices(container);
  else logs(container);
  decorate();
}
function dashboard(el: HTMLElement) {
  const { licenses, packages, events, reports } = overview;
  const active = licenses.filter(
    (l) => l.status === 'active' && Date.parse(l.expires_at!) > Date.now(),
  ).length;
  const expired = licenses.filter(
    (l) => l.expires_at && Date.parse(l.expires_at) <= Date.now(),
  ).length;
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">CONTROL ROOM / 01</p><h1>همه‌چیز، زیر کنترل.</h1><p class="muted">نمای روشن از اشتراک‌ها، محتوا و اتفاق‌های اخیر.</p></div><button class="button secondary" id="admin-refresh">${icon('refresh-cw')}به‌روزرسانی</button></div>
  <div class="metrics">${[
    [licenses.length, 'کل لایسنس‌ها', 'key-round'],
    [active, 'اشتراک فعال', 'badge-check'],
    [expired, 'منقضی‌شده', 'clock-3'],
    [packages.filter((p) => p.status === 'published').length, 'پکیج منتشرشده', 'package'],
  ]
    .map(
      ([n, label, i]) =>
        `<div class="metric">${icon(String(i))}<span>${label}</span><strong>${fa(Number(n))}</strong></div>`,
    )
    .join('')}</div>
  <div class="dashboard-grid"><section class="panel"><div class="section-heading"><h2>ترکیب اشتراک‌ها</h2><span class="subtle">بر اساس دادهٔ ثبت‌شده</span></div><div class="tier-bars">${[
    'normal',
    'pro',
    'vip',
  ]
    .map((t) => {
      const count = licenses.filter((l) => l.tier === t).length;
      return `<div><div>${badge(t)}<b>${fa(count)} <small>لایسنس</small></b></div><progress max="${Math.max(licenses.length, 1)}" value="${count}"></progress></div>`;
    })
    .join(
      '',
    )}</div><div class="panel-note">${icon('info')}تعداد لایسنس به‌معنی تعداد اشخاص احراز هویت‌شده نیست.</div></section>
  <section class="panel"><div class="section-heading"><h2>وضعیت محتوا</h2><span class="subtle">چرخهٔ انتشار</span></div><div class="release-stats">${['published', 'draft', 'archived'].map((s) => `<div><span class="status ${s}">${statuses[s]}</span><strong>${fa(packages.filter((p) => p.status === s).length)}</strong></div>`).join('')}</div><p class="muted">${fa(reports.filter((r) => r.status === 'installed').length)} نصب موفق و ${fa(reports.filter((r) => r.status === 'failed').length)} خطا توسط کلاینت‌ها گزارش شده است.</p></section></div>
  <section class="panel"><div class="section-heading"><h2>آخرین فعالیت‌ها</h2><span class="subtle">ردپای عملیات مدیریتی</span></div>${eventTable(events.slice(0, 6))}</section>`;
  el.querySelector('#admin-refresh')!.addEventListener('click', () => void refreshPage());
}
function licenses(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">ACCESS MANAGEMENT / 02</p><h1>هر دسترسی، یک هویت.</h1><p class="muted">تولید، تمدید و کنترل لایسنس‌های تک‌دستگاهی.</p></div>${can('license') ? `<button class="button" id="generate">${icon('plus')}تولید لایسنس</button>` : ''}</div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="license-search" placeholder="جست‌وجوی نام، شناسه یا برچسب…"></label><select id="license-filter"><option value="all">همه وضعیت‌ها</option>${Object.entries(
    statuses,
  )
    .slice(0, 4)
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join(
      '',
    )}<option value="expired">منقضی‌شده</option><option value="archived">بایگانی‌شده</option></select></div><div class="panel table-panel" id="license-table"></div>`;
  const render = () => {
    const q = (el.querySelector('#license-search') as HTMLInputElement).value.toLowerCase(),
      filter = (el.querySelector('#license-filter') as HTMLSelectElement).value;
    const items = overview.licenses.filter(
      (l) =>
        `${l.id} ${l.prefix} ${l.display_name || ''} ${(l.tags || []).join(' ')}`
          .toLowerCase()
          .includes(q) &&
        (filter === 'archived' ? !!l.archived : !l.archived) &&
        (filter === 'all' ||
          filter === 'archived' ||
          (filter === 'expired'
            ? l.expires_at && Date.parse(l.expires_at) < Date.now()
            : l.status === filter)),
    );
    el.querySelector('#license-table')!.innerHTML = items.length
      ? `<div class="table-scroll"><table><thead><tr><th>شناسه / پیشوند</th><th>سطح</th><th>وضعیت</th><th>اعتبار تا</th><th>دستگاه</th><th>عملیات</th></tr></thead><tbody>${items.map((l) => `<tr><td><b>${esc(l.display_name || 'بدون نام')}</b><small class="cell-sub"><code>${esc(l.prefix)}••••</code></small><small class="cell-sub" dir="ltr">${l.id.slice(0, 8)}</small></td><td>${badge(l.tier)}</td><td><span class="status ${l.status}">${l.expires_at && Date.parse(l.expires_at) < Date.now() ? 'منقضی‌شده' : statuses[l.status]}</span></td><td>${date(l.expires_at)}<small class="cell-sub">${fa(l.duration_days)} روز از فعال‌سازی</small></td><td>${l.device_thumbprint ? `<span class="device-dot"></span><code>${esc(l.device_thumbprint.slice(0, 8))}</code>` : '—'}</td><td><button class="text-button" data-license="${l.id}">پرونده ${icon('chevron-left')}</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('لایسنسی پیدا نشد', 'فیلتر را تغییر دهید یا یک لایسنس جدید بسازید.', 'key-round');
    el.querySelectorAll<HTMLButtonElement>('[data-license]').forEach(
      (b) =>
        (b.onclick = () =>
          licenseDialog(overview.licenses.find((l) => l.id === b.dataset.license)!)),
    );
    decorate();
  };
  el.querySelector('#license-search')!.addEventListener('input', render);
  el.querySelector('#license-filter')!.addEventListener('change', render);
  el.querySelector('#generate')?.addEventListener('click', generateDialog);
  render();
}
function generateDialog() {
  const d = modal(
    'تولید لایسنس',
    `<p class="muted">کد کامل فقط یک‌بار نمایش داده می‌شود. شروع اعتبار در اولین فعال‌سازی است.</p><form id="generate-form"><div class="form-grid">${field('سطح اشتراک', '<select name="tier"><option value="normal">Normal</option><option value="pro">Pro</option><option value="vip">VIP</option></select>')}${field('اعتبار (روز)', '<input name="duration_days" type="number" min="1" max="1095" value="30" required>')}${field('تعداد', '<input name="count" type="number" min="1" max="100" value="1" required>')}</div><div class="notice">${icon('monitor')}هر لایسنس فقط یک دستگاه فعال دارد.</div><button class="button full" type="submit">تولید و نمایش کدها</button></form>`,
  );
  d.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    void busy(d.querySelector('button[type=submit]')!, async () => {
      const f = new FormData(d.querySelector('form')!);
      const { codes } = await api(
        '/admin/licenses',
        {
          tier: f.get('tier'),
          duration_days: Number(f.get('duration_days')),
          count: Number(f.get('count')),
        },
        token,
      );
      d.close();
      const out = modal(
        'کدهای شما آماده‌اند',
        `<p class="muted">این کدها در فهرست مدیریت قابل بازیابی نیستند. اکنون آن‌ها را ذخیره کنید.</p><textarea id="codes" rows="7" readonly dir="ltr">${esc(codes.join('\n'))}</textarea><div class="actions"><button class="button" id="download-codes">${icon('download')}خروجی CSV</button><button class="button secondary" id="copy-codes">کپی کدها</button></div>`,
      );
      out.querySelector('#copy-codes')!.addEventListener(
        'click',
        () =>
          void navigator.clipboard
            .writeText(codes.join('\n'))
            .then(() => toast('کدها کپی شدند.'))
            .catch(handleError),
      );
      out.querySelector('#download-codes')!.addEventListener('click', () => {
        const url = URL.createObjectURL(
          new Blob(['code\n' + codes.join('\n')], { type: 'text/csv' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'uhm-licenses.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      await refreshPage();
    });
  };
}
function licenseDialog(l: Overview['licenses'][number]) {
  licenseProfile(l, { data: overview, token, reload: refreshPage });
}
function packages(el: HTMLElement, versions: boolean) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">CONTENT STUDIO / 03</p><h1>${versions ? 'انتشار بعدی، دقیق‌تر.' : 'محتوا را شما می‌سازید.'}</h1><p class="muted">${versions ? 'نسخه، تغییرات و چرخهٔ انتشار پکیج‌ها.' : 'چند فایل، چند مرحله؛ بدون نیاز به ساخت دوباره لانچر.'}</p></div>${can('content') ? '<button class="button" id="new-package">' + icon('plus') + 'پکیج جدید</button>' : ''}</div><div class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>پکیج</th><th>نسخه</th><th>سطح</th><th>وضعیت</th><th>فایل / پیش‌نیاز</th><th>عملیات</th></tr></thead><tbody>${overview.packages.map((p) => `<tr><td><div class="table-product"><img src="${esc(assetUrl(p.image))}" alt=""><span>${esc(p.name)}<small class="cell-sub" dir="ltr">${esc(p.slug)}</small></span></div></td><td><code>v${esc(p.version)}</code></td><td>${badge(p.tier)}</td><td><span class="status ${p.status}">${statuses[p.status]}</span></td><td>${fa(p.files.length)} / ${fa(p.dependencies.length)}</td><td><button class="text-button" data-edit="${p.id}">${can('content') ? 'ویرایش / انتشار' : 'مشاهده'} ${icon('chevron-left')}</button></td></tr>`).join('')}</tbody></table></div></div><p class="fine-print">انتشار نسخه‌های بدون فایل در این پیش‌نمایش صرفاً نمونه است. API انتشار واقعی، فایل و هش معتبر را الزامی می‌کند. نسخهٔ منتشرشده تغییرناپذیر است.</p>`;
  el.querySelector('#new-package')?.addEventListener('click', () => editPackage());
  el.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(
    (b) => (b.onclick = () => editPackage(overview.packages.find((p) => p.id === b.dataset.edit))),
  );
}

async function versionsPage(el: HTMLElement) {
  const { releases } = (await api('/admin/releases', undefined, token)) as {
    releases: {
      package_id: string;
      version: string;
      manifest: PackageSpec;
      published_at: string;
    }[];
  };
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">RELEASE ARCHIVE / 04</p><h1>هر انتشار، یک نقطهٔ بازگشت.</h1><p class="muted">نسخه‌های منتشرشده به‌صورت snapshot تغییرناپذیر نگهداری می‌شوند؛ این صفحه ۵۰۰ انتشار اخیر را نشان می‌دهد.</p></div></div><div class="panel">${releases.length ? `<div class="table-scroll"><table><thead><tr><th>پکیج</th><th>نسخه</th><th>انتشار</th><th>تغییرات</th><th>عملیات</th></tr></thead><tbody>${releases.map((r, i) => `<tr><td>${esc(r.manifest.name)}</td><td><code>v${esc(r.version)}</code></td><td>${date(r.published_at)}</td><td><span class="release-notes">${esc(r.manifest.changelog || '—')}</span></td><td><button class="text-button" data-release="${i}">جزئیات انتشار</button></td></tr>`).join('')}</tbody></table></div>` : empty('هنوز انتشار واقعی ثبت نشده', 'پس از اتصال فایل و انتشار پکیج، snapshot نسخه در این بخش ذخیره می‌شود. پکیج‌های نمونه سابقه انتشار واقعی ندارند.', 'git-branch')}</div><div class="notice">${icon('info')}ساخت پیش‌نویس نسخه جدید، آخرین نسخه منتشرشده را از کاتالوگ کاربران حذف نمی‌کند. بازگردانی فایل‌های نصب‌شده به نسخه قدیمی هنوز نیازمند جریان جداگانه است.</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-release]').forEach(
    (b) =>
      (b.onclick = () => {
        const r = releases[Number(b.dataset.release)];
        const d = modal(
          'نسخه ' + r.version,
          `<h3>${esc(r.manifest.name)}</h3><p class="preserve muted">${esc(r.manifest.changelog)}</p><dl class="definition"><dt>تعداد فایل‌ها</dt><dd>${fa(r.manifest.files.length)}</dd><dt>مراحل نصب</dt><dd>${fa(r.manifest.steps.length)}</dd><dt>انتشار</dt><dd>${date(r.published_at)}</dd></dl>${can('content') ? '<button class="button full" id="fork-release">ساخت پیش‌نویس از این نسخه</button>' : ''}`,
        );
        d.querySelector('#fork-release')?.addEventListener('click', () => {
          d.close();
          const parts = (overview.packages.find((p) => p.id === r.package_id)?.version || r.version)
            .split('.')
            .map(Number);
          parts[2]++;
          editPackage({
            ...r.manifest,
            version: parts.join('.'),
            status: 'draft',
            released_at: null,
            scheduled_at: null,
          });
        });
      }),
  );
}

function editPackage(existing?: PackageSpec) {
  const writable = can('content');
  const p =
    existing ||
    ({
      id: crypto.randomUUID(),
      slug: '',
      name: '',
      description: '',
      category: 'graphics',
      tier: 'normal',
      image: '/images/01.jpg',
      version: '1.0.0',
      changelog: '',
      dependencies: [],
      files: [],
      steps: [],
      status: 'draft',
      released_at: null,
    } as PackageSpec);
  const d = modal(
    existing ? 'استودیوی پکیج' : 'ساخت پکیج جدید',
    `<div class="studio-intro"><span class="console-pill">MANIFEST STUDIO</span><h3>از لینک تا نصب؛ دقیق و قابل تکرار.</h3><p>فایل‌ها، رمز استخراج، پیش‌نیازها و مراحل نصب را جداگانه تنظیم کنید. خروجی انتشار تغییرناپذیر است.</p></div><form id="package-form"><fieldset ${writable ? '' : 'disabled'}><div class="form-grid">${field('نام پکیج', `<input name="name" required minlength="2" maxlength="80" value="${esc(p.name)}">`)}${field('شناسه خوانا (انگلیسی)', `<input name="slug" required dir="ltr" pattern="[a-z0-9-]{2,64}" value="${esc(p.slug)}">`)}${field('نسخه', `<input name="version" required dir="ltr" pattern="[0-9]+\.[0-9]+\.[0-9]+" value="${esc(p.version)}">`)}${field('سطح دسترسی', `<select name="tier">${['normal', 'pro', 'vip'].map((t) => `<option ${p.tier === t ? 'selected' : ''} value="${t}">${t.toUpperCase()}</option>`).join('')}</select>`)}${field(
      'دسته‌بندی',
      `<select name="category">${Object.entries(category)
        .map(([v, l]) => `<option value="${v}" ${p.category === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>`,
    )}${field('تصویر کاور (HTTPS یا تصویر داخلی)', `<input name="image" required dir="ltr" value="${esc(p.image)}" placeholder="https://… یا /images/01.jpg">`)}}</div>${field('توضیح کوتاه', `<input name="short_description" maxlength="240" value="${esc(p.short_description || '')}">`)}<div class="form-grid">${field('نوع محتوا', `<select name="content_type">${['car', 'track', 'skin', 'python_app', 'lua_app', 'csp', 'ppfilter', 'pack'].map((k) => `<option value="${k}" ${(p.content_type || 'pack') === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${field('سازنده', `<input name="author" maxlength="120" value="${esc(p.author || '')}">`)}${field('برند', `<input name="brand" maxlength="120" value="${esc(p.brand || '')}">`)}${field('کانال انتشار', `<select name="channel"><option value="stable">عمومی</option><option value="test" ${p.channel === 'test' ? 'selected' : ''}>تست / مخفی از کاتالوگ عمومی</option></select>`)}${field('زمان انتشار (زمان محلی؛ اختیاری)', `<input name="scheduled_at" type="datetime-local" value="${p.scheduled_at ? new Date(Date.parse(p.scheduled_at) - new Date(p.scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">`)}</div>${field('برچسب‌ها (با کامای انگلیسی)', `<input name="tags" value="${esc((p.tags || []).join(', '))}">`)}${field('تصاویر اضافی HTTPS (هر خط یک لینک)', `<textarea name="images" dir="ltr">${esc((p.images || []).join('\n'))}</textarea>`)}${field('توضیحات', `<textarea name="description" minlength="10" maxlength="3000" required>${esc(p.description)}</textarea>`)}${field('تغییرات این نسخه', `<textarea name="changelog" maxlength="3000">${esc(p.changelog)}</textarea>`)}<h3 class="form-section">پیش‌نیازها</h3><div class="checks">${
      overview.packages
        .filter((q) => q.id !== p.id)
        .map(
          (q) =>
            `<label><input type="checkbox" name="dependencies" value="${q.id}" ${p.dependencies.includes(q.id) ? 'checked' : ''}>${esc(q.name)} ${badge(q.tier)}</label>`,
        )
        .join('') || '<span class="muted">پکیج دیگری وجود ندارد.</span>'
    }</div><div class="section-heading form-section"><h3>۲ · فایل‌ها و رمزهای استخراج</h3><button type="button" class="text-button" id="add-file">${icon('plus')}افزودن فایل</button></div><div id="file-rows"></div><div class="section-heading form-section"><h3>۳ · مراحل نصب به ترتیب اجرا</h3><button type="button" class="text-button" id="add-step">افزودن مرحله</button></div><div id="install-steps"></div><p class="studio-summary" id="studio-summary"></p><p class="fine-print">مقصد نسبت به ریشه بازی است. اجرای خودکار EXE ممنوع است. برای استخراج RAR/7z به استخراج‌کنندهٔ تأییدشده در نسخه Native نیاز است.</p><div class="actions"><button class="button" type="submit">ذخیره پیش‌نویس</button>${existing && p.status === 'draft' && hasPermission(overview.admin, 'content.publish') ? '<button type="button" class="button secondary" id="validate-package">اعتبارسنجی سرور</button><button type="button" class="button secondary" id="test-package">نصب تست روی این دستگاه</button><button type="button" class="button secondary" id="publish-package">انتشار نسخه</button>' : ''}${existing && p.status === 'published' && hasPermission(overview.admin, 'content.publish') ? '<button type="button" class="button secondary" id="archive-package">بایگانی</button>' : ''}</div></fieldset></form>`,
    true,
  );
  const rows = d.querySelector('#file-rows')!;
  const stepsEl = d.querySelector('#install-steps')!;
  function refreshFiles() {
    const files = [...rows.querySelectorAll<HTMLElement>('.file-row')].map((el) => ({
      id: el.dataset.id!,
      name: (el.querySelector('[data-f=name]') as HTMLInputElement).value || 'فایل بدون نام',
    }));
    stepsEl.querySelectorAll<HTMLSelectElement>('[data-step-file]').forEach((select) => {
      const current = select.value || select.dataset.initial;
      select.innerHTML = files
        .map(
          (f) =>
            `<option value="${f.id}" ${f.id === current ? 'selected' : ''}>${esc(f.name)}</option>`,
        )
        .join('');
    });
    const bytes = [...rows.querySelectorAll<HTMLInputElement>('[data-f=size]')].reduce(
      (n, i) => n + Number(i.value || 0),
      0,
    );
    const encrypted = [
      ...rows.querySelectorAll<HTMLInputElement>('[data-f=archive_password]'),
    ].filter((i) => i.value).length;
    d.querySelector('#studio-summary')!.textContent =
      `${fa(files.length)} فایل · ${fa(stepsEl.children.length)} مرحله · ${(bytes / 1e6).toFixed(1)} MB · ${fa(encrypted)} رمز آرشیو`;
  }
  function move(el: HTMLElement, down: boolean) {
    const sibling = down ? el.nextElementSibling : el.previousElementSibling;
    if (sibling) down ? sibling.after(el) : sibling.before(el);
    refreshFiles();
  }
  function stepRow(step?: PackageSpec['steps'][number], fileId?: string) {
    const el = document.createElement('div');
    el.className = 'install-step';
    el.dataset.id = step?.id || crypto.randomUUID();
    el.innerHTML = `<div class="section-heading"><b>مرحله نصب</b><div class="actions"><button type="button" data-up aria-label="مرحله بالاتر">↑</button><button type="button" data-down aria-label="مرحله پایین‌تر">↓</button><button type="button" data-remove aria-label="حذف مرحله">${icon('trash-2')}</button></div></div><div class="form-grid">${field('فایل منبع', '<select data-step-file required></select>')}${field('عملیات', `<select data-step="action"><option value="extract" ${step?.action === 'extract' ? 'selected' : ''}>استخراج آرشیو</option><option value="copy" ${step?.action === 'copy' ? 'selected' : ''}>کپی فایل</option></select>`)}${field('مسیر نسبی مقصد', `<input data-step="destination" required dir="ltr" value="${esc(step?.destination || 'extension')}">`)}${field('زیرپوشه منبع آرشیو (اختیاری)', `<input data-step="source_subdir" dir="ltr" value="${esc(step?.source_subdir || '')}" placeholder="wrapper/content/cars">`)}${field('وابستگی مراحل (شناسه‌ها با کاما؛ باید بالاتر باشند)', `<input data-step="depends_on" dir="ltr" value="${esc((step?.depends_on || []).join(', '))}">`)}<small class="muted" dir="ltr">Step ID: ${esc(el.dataset.id!)}</small>${field('فایل موجود', `<select data-step="overwrite"><option value="backup">بکاپ و جایگزینی</option><option value="fail" ${step?.overwrite === 'fail' ? 'selected' : ''}>توقف در صورت تداخل</option></select>`)}</div>`;
    (el.querySelector('[data-step-file]') as HTMLSelectElement).dataset.initial =
      step?.file_id || fileId || '';
    el.querySelector('[data-up]')!.addEventListener('click', () => move(el, false));
    el.querySelector('[data-down]')!.addEventListener('click', () => move(el, true));
    el.querySelector('[data-remove]')!.addEventListener('click', () => {
      el.remove();
      refreshFiles();
    });
    stepsEl.append(el);
    refreshFiles();
    decorate();
  }
  function row(file?: PackageSpec['files'][number]) {
    const el = document.createElement('div');
    el.className = 'file-row';
    el.dataset.id = file?.id || crypto.randomUUID();
    el.innerHTML = `<div class="section-heading"><b>فایل دانلود / جزء آرشیو</b><div class="actions"><button type="button" data-up aria-label="فایل بالاتر">↑</button><button type="button" data-down aria-label="فایل پایین‌تر">↓</button><button type="button" class="icon-button remove-file" aria-label="حذف فایل">${icon('trash-2')}</button></div></div><div class="form-grid">${field('نام دقیق فایل (مانند mod.part1.rar)', `<input data-f="name" required maxlength="100" value="${esc(file?.name || '')}" dir="ltr">`)}${field('فرمت', `<select data-f="format">${['zip', 'rar', '7z', 'file', 'exe'].map((f) => `<option ${file?.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}</div>${field('لینک مستقیم HTTPS', `<input data-f="url" type="url" required dir="ltr" value="${esc(file?.url || '')}" placeholder="https://…">`)}${field('لینک‌های جایگزین HTTPS (هر خط یک لینک؛ حداکثر ۵)', `<textarea data-f="mirrors" dir="ltr">${esc((file?.mirrors || []).join('\n'))}</textarea>`)}${field('SHA-256 (۶۴ کاراکتر)', `<input data-f="sha256" required pattern="[a-f0-9]{64}" dir="ltr" value="${esc(file?.sha256 || '')}">`)}<div class="form-grid">${field('حجم دقیق (بایت)', `<input data-f="size" type="number" min="1" required value="${file?.size || ''}">`)}${field('رمز آرشیو (اختیاری)', `<input data-f="archive_password" type="password" maxlength="256" autocomplete="new-password" dir="ltr" value="${esc(file?.archive_password || '')}">`)}</div><p class="fine-print">رمز فقط به مدیر محتوا و دریافت‌کننده مجاز این پکیج داده می‌شود؛ از رمز حساب کاربری استفاده نکنید. برای آرشیو چندبخشی، همه بخش‌ها را با نام اصلی وارد و فقط بخش اول را در مرحله استخراج انتخاب کنید.</p>`;
    rows.append(el);
    el.querySelector('.remove-file')!.addEventListener('click', () => {
      stepsEl.querySelectorAll<HTMLElement>('.install-step').forEach((step) => {
        if ((step.querySelector('[data-step-file]') as HTMLSelectElement).value === el.dataset.id)
          step.remove();
      });
      el.remove();
      refreshFiles();
    });
    el.querySelector('[data-up]')!.addEventListener('click', () => move(el, false));
    el.querySelector('[data-down]')!.addEventListener('click', () => move(el, true));
    el.addEventListener('input', refreshFiles);
    refreshFiles();
    decorate();
    return el.dataset.id!;
  }
  p.files.forEach((f) => row(f));
  p.steps.forEach((step) => stepRow(step));
  refreshFiles();
  d.querySelector('#add-file')!.addEventListener('click', () => {
    const id = row();
    stepRow(undefined, id);
  });
  d.querySelector('#add-step')!.addEventListener('click', () => stepRow());
  d.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    void busy(d.querySelector('button[type=submit]')!, async () => {
      const form = d.querySelector('form')!;
      const f = new FormData(form);
      const files: any[] = [],
        steps: any[] = [];
      rows.querySelectorAll<HTMLElement>('.file-row').forEach((el) => {
        const get = (k: string) => (el.querySelector(`[data-f=${k}]`) as HTMLInputElement).value;
        files.push({
          id: el.dataset.id,
          name: get('name'),
          format: get('format'),
          url: get('url'),
          mirrors: get('mirrors')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
          sha256: get('sha256'),
          size: Number(get('size')),
          ...(get('archive_password') ? { archive_password: get('archive_password') } : {}),
        });
      });
      stepsEl.querySelectorAll<HTMLElement>('.install-step').forEach((el) => {
        const get = (k: string) => (el.querySelector(`[data-step=${k}]`) as HTMLInputElement).value;
        steps.push({
          id: el.dataset.id,
          file_id: (el.querySelector('[data-step-file]') as HTMLSelectElement).value,
          action: get('action'),
          destination: get('destination'),
          overwrite: get('overwrite'),
          ...(get('source_subdir').trim() ? { source_subdir: get('source_subdir').trim() } : {}),
          depends_on: get('depends_on')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        });
      });
      const pkg = PackageSpec.parse({
        ...p,
        ...Object.fromEntries(f),
        dependencies: f.getAll('dependencies'),
        tags: String(f.get('tags') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        images: String(f.get('images') || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        scheduled_at: f.get('scheduled_at')
          ? new Date(String(f.get('scheduled_at'))).toISOString()
          : null,
        files,
        steps,
        status: 'draft',
        released_at: null,
      });
      const advanced = Boolean(
        pkg.short_description ||
        pkg.author ||
        pkg.brand ||
        (pkg.content_type && pkg.content_type !== 'pack') ||
        pkg.tags?.length ||
        pkg.images?.length ||
        pkg.scheduled_at ||
        pkg.channel === 'test' ||
        pkg.files.some((f) => f.mirrors?.length) ||
        pkg.steps.some((s) => s.source_subdir || s.depends_on?.length),
      );
      if (advanced) await requireContentV2();
      await api('/admin/packages', pkg, token);
      d.close();
      toast('پیش‌نویس ذخیره شد؛ برای انتشار دوباره آن را باز کنید.');
      await refreshPage();
    });
  };
  d.querySelector<HTMLButtonElement>('#test-package')?.addEventListener('click', function () {
    void busy(this, async () => {
      if (!native)
        throw new Error(
          'تست نصب واقعی فقط در برنامه ویندوز و با لایسنس فعال همان دستگاه انجام می‌شود.',
        );
      if (
        !window.confirm(
          'نسخه ذخیره‌شده روی مسیر واقعی انتخاب‌شده نصب شود؟ بهتر است یک کپی آزمایشی بازی را انتخاب کنید. پیش از اعمال، فهرست فایل‌ها تأیید خواهد شد.',
        )
      )
        return;
      const grant = localStore.getItem('uhm-grant');
      if (!grant) throw new Error('ابتدا لایسنس همین دستگاه را فعال کنید.');
      const plan = await api(
        `/admin/packages/${p.id}/test-plan`,
        { grant, ...(await proof('plan')) },
        token,
      );
      d.close();
      window.dispatchEvent(new CustomEvent('uhm-test-install', { detail: plan }));
    });
  });
  d.querySelector<HTMLButtonElement>('#validate-package')?.addEventListener('click', function () {
    void busy(this, async () => {
      await requireContentV2();
      const result = await api(`/admin/packages/${p.id}/validate`, {}, token);
      toast(
        `ساختار ذخیره‌شده معتبر است؛ ${result.files} فایل و ${result.steps} مرحله. این آزمون، نصب واقعی نیست.`,
      );
    });
  });
  d.querySelector<HTMLButtonElement>('#publish-package')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (
        !window.confirm(
          'نسخه ذخیره‌شده با فایل‌ها و مراحل فعلی منتشر شود؟ تغییرات ذخیره‌نشده این فرم منتشر نمی‌شوند.',
        )
      )
        return;
      await api(`/admin/packages/${p.id}/publish`, {}, token);
      d.close();
      toast('نسخه منتشر شد.');
      await refreshPage();
    });
  });
  d.querySelector<HTMLButtonElement>('#archive-package')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!window.confirm('پکیج از کاتالوگ حذف و بایگانی شود؟ تاریخچه نسخه‌ها محفوظ می‌ماند.'))
        return;
      await api(`/admin/packages/${p.id}/archive`, {}, token);
      d.close();
      toast('پکیج بایگانی شد.');
      await refreshPage();
    });
  });
}
function devices(el: HTMLElement) {
  const items = overview.licenses.filter((l) => l.device_thumbprint);
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">DEVICE REGISTRY / 04</p><h1>یک لایسنس. یک دستگاه.</h1><p class="muted">اتصال‌ها بر اساس کلید دستگاه هستند، نه IP کاربر.</p></div></div><div class="panel table-panel">${items.length ? `<div class="table-scroll"><table><thead><tr><th>اثر انگشت کلید</th><th>اشتراک</th><th>فعال‌سازی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${items.map((l) => `<tr><td><code dir="ltr">${esc(l.device_thumbprint?.slice(0, 24))}…</code></td><td>${badge(l.tier)}</td><td>${date(l.activated_at)}</td><td><span class="status ${l.status}">${statuses[l.status]}</span></td><td>${can('license') ? `<button class="text-button" data-device="${l.id}">مدیریت اتصال</button>` : 'فقط مشاهده'}</td></tr>`).join('')}</tbody></table></div>` : empty('هنوز دستگاهی متصل نیست', 'با فعال‌سازی لایسنس در لانچر، دستگاه اینجا نمایش داده می‌شود.', 'monitor')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(
    (b) =>
      (b.onclick = () => licenseDialog(overview.licenses.find((l) => l.id === b.dataset.device)!)),
  );
}
function eventTable(events: AuditEvent[]) {
  return events.length
    ? `<div class="table-scroll"><table><thead><tr><th>رویداد</th><th>عامل</th><th>هدف</th><th>زمان</th></tr></thead><tbody>${events.map((e) => `<tr><td><code>${esc(e.action)}</code></td><td><code>${esc(e.actor.slice(0, 14))}</code></td><td><code>${esc(e.target.slice(0, 16))}</code></td><td>${date(e.created_at)} <small>${new Date(e.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</small></td></tr>`).join('')}</tbody></table></div>`
    : empty('رویدادی ثبت نشده', 'عملیات واقعی پنل در این بخش ثبت می‌شوند.', 'scroll-text');
}
function logs(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">AUDIT TRAIL / 05</p><h1>هیچ تغییری بی‌ردپا نیست.</h1><p class="muted">تاریخچهٔ عملیات؛ بدون ثبت کد کامل لایسنس یا کلید خصوصی.</p></div></div><section class="panel">${eventTable(overview.events)}</section>`;
}
export function loginDialog(demo: boolean, onSuccess: (token: string) => void) {
  const d = modal(
    'ورود به اتاق کنترل',
    `<p class="muted">${demo ? 'محیط توسعه: ورود نمایشی به داده‌های محلی. این ورود در نسخه عملیاتی وجود ندارد.' : 'ورود مدیران با Supabase Auth و تأیید دومرحله‌ای.'}</p>${demo ? '<button class="button full" id="demo-admin">ورود به پنل نمایشی</button>' : `<form id="admin-login">${field('ایمیل', '<input name="email" type="email" required dir="ltr" autocomplete="username">')}${field('رمز عبور', '<input name="password" type="password" required dir="ltr" autocomplete="current-password">')}<button class="button full" type="submit">ورود امن</button></form>`}`,
  );
  d.querySelector('.modal-body')?.insertAdjacentHTML(
    'afterbegin',
    `<section class="license-login-panel"><div class="console-pill">DEVICE-BOUND ADMIN</div><h3>ورود با لایسنس مدیریت</h3><p class="muted">کدی که مالک برای شما دسترسی داده است؛ همین لایسنس در برنامه هم قابل استفاده است.</p><form id="license-admin-login">${field('کد لایسنس (اگر قبلاً فعال کرده‌اید، خالی بگذارید)', '<input name="license_code" dir="ltr" autocomplete="off" placeholder="UHM-…">')}<button class="button full" type="submit">ورود با لایسنس این دستگاه</button></form></section>`,
  );
  d.querySelector<HTMLFormElement>('#license-admin-login')!.onsubmit = (e) => {
    e.preventDefault();
    void busy(d.querySelector('#license-admin-login button')!, async () => {
      const code = String(new FormData(e.target as HTMLFormElement).get('license_code')).trim();
      if (code) {
        const result = await api('/licenses/activate', { code, ...(await proof('activate')) });
        if (native) await invoke('verify_offline_grant', { grant: result.grant });
        localStore.setItem('uhm-license', JSON.stringify(result.license));
        localStore.setItem('uhm-grant', result.grant);
        window.dispatchEvent(new Event('license-activated'));
      }
      const token = await licenseAdminSession();
      d.close();
      onSuccess(token);
    });
  };
  d.querySelector<HTMLButtonElement>('#demo-admin')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      sessionStore.removeItem('uhm-admin-mode');
      const session = await api('/demo/session', {});
      d.close();
      onSuccess(session.token);
    });
  });
  d.querySelector<HTMLFormElement>('#admin-login')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(d.querySelector('button[type=submit]')!, async () => {
      if (!supabase) throw new Error('تنظیمات Supabase برای پنل وارد نشده است.');
      const f = new FormData(e.target as HTMLFormElement);
      const { error } = await supabase.auth.signInWithPassword({
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      if (error) throw new Error('ورود ناموفق بود.');
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const factor = factors.totp.find((f) => f.status === 'verified');
      if (!factor)
        throw new Error(
          'ابتدا MFA مدیر را در فرایند راه‌اندازی امن ثبت کنید. دسترسی مدیریتی بدون MFA داده نمی‌شود.',
        );
      d.close();
      const m = modal(
        'تأیید دومرحله‌ای',
        `<form id="mfa-form">${field('کد برنامه احراز هویت', '<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required dir="ltr" autocomplete="one-time-code">')}<button class="button full" type="submit">تأیید</button></form>`,
      );
      m.querySelector('form')!.onsubmit = (e) => {
        e.preventDefault();
        void busy(m.querySelector('button[type=submit]')!, async () => {
          const code = String(new FormData(e.target as HTMLFormElement).get('code'));
          const { error } = await supabase!.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code,
          });
          if (error) throw new Error('کد معتبر نیست.');
          const { data } = await supabase!.auth.getSession();
          m.close();
          sessionStore.removeItem('uhm-admin-mode');
          onSuccess(data.session!.access_token);
        });
      };
    });
  });
}
