import { inspectArtifact } from './artifact-inspector';
import { mountPackageBuilder } from './package-builder';
import { manageCategories } from './package-categories';
import { renderUsers } from './admin-users';
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
  type PackageCategory,
  licenseState,
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
  capabilities?: string[];
  categories?: PackageCategory[];
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
  scheduled: 'شروع در آینده',
  expired: 'منقضی‌شده',
};
const can = (section: string) =>
  hasPermission(
    overview.admin,
    ({ license: 'licenses.create', content: 'content.update' }[section] || section) as Permission,
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
  for (const c of overview.categories || []) category[c.id] = c.name;
  const navPermissions: Record<string, Permission> = {
    licenses: 'licenses.read',
    users: 'users.read',
    devices: 'devices.read',
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
    if (permission)
      b.hidden =
        b.dataset.nav === 'users'
          ? !(
              overview.capabilities?.includes('user-profiles-v1') &&
              (can('users.read') || can('users.manage'))
            )
          : b.dataset.nav === 'devices'
            ? !(can('devices.read') || can('licenses.read'))
            : b.dataset.nav === 'team'
              ? !(can('team.manage') || can('roles.manage'))
              : b.dataset.nav === 'licenses'
                ? !(can('licenses.read') || can('licenses.create'))
                : b.dataset.nav === 'packages'
                  ? ![
                      'content.read',
                      'content.create',
                      'content.update',
                      'content.publish',
                      'categories.manage',
                    ].some((p) => hasPermission(overview.admin, p as Permission))
                  : !hasPermission(overview.admin, permission);
  });
  const roleLabels: Record<string, string> = {
    owner: 'مالک اصلی',
    content_manager: 'مدیر محتوا',
    license_manager: 'مدیر لایسنس',
    support: 'پشتیبان',
    viewer: 'مشاهده‌گر',
  };
  document.querySelectorAll('[data-admin-role]').forEach((el) => {
    el.textContent = roleLabels[overview.admin.role] || 'مدیریت';
  });
  document.querySelectorAll<HTMLElement>('.nav-group').forEach((group) => {
    group.hidden = !group.querySelector('[data-nav]:not([hidden])');
  });
  if (await renderConsole(container, page, { data: overview, token, reload })) return;
  if (page === 'dashboard') dashboard(container);
  else if (page === 'licenses') licenses(container);
  else if (page === 'users') await renderUsers(container, overview.admin, token);
  else if (page === 'versions') await versionsPage(container);
  else if (page === 'packages') packages(container, false);
  else if (page === 'devices') await devices(container);
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
  const drafts = packages.filter((p) => p.status === 'draft').length;
  const published = packages.filter((p) => p.status === 'published').length;
  const openErrors = (overview.telemetry || []).filter(
    (e) => !e.resolved_at && (e.type.endsWith('failed') || e.type === 'app_error'),
  ).length;
  const metrics = [
    {
      allowed: can('licenses.read'),
      value: licenses.length,
      label: 'کل لایسنس‌ها',
      detail: 'ثبت‌شده در سرویس',
      symbol: 'key-round',
    },
    {
      allowed: can('licenses.read'),
      value: active,
      label: 'اشتراک فعال',
      detail: 'فعال و دارای اعتبار زمانی',
      symbol: 'badge-check',
    },
    {
      allowed: can('content.read'),
      value: published,
      label: 'پکیج منتشرشده',
      detail: `${fa(drafts)} پیش‌نویس در فضای محتوا`,
      symbol: 'package',
    },
    {
      allowed: can('errors.read'),
      value: openErrors,
      label: 'خطای رسیدگی‌نشده',
      detail: 'در رویدادهای دریافتی اخیر',
      symbol: 'triangle-alert',
    },
  ].filter((m) => m.allowed);
  const action = (target: string, title: string, detail: string, symbol: string) =>
    `<button class="dashboard-action" data-open="${target}">${icon(symbol)}<span><b>${title}</b><small>${detail}</small></span>${icon('arrow-up-left')}</button>`;
  el.innerHTML = `<section class="dashboard-welcome"><div><div class="eyebrow" lang="en"><span class="eyebrow-line"></span> UHM / CONTROL CENTER</div><h1>همه‌چیز، زیر کنترل.</h1><p>یک نگاه روشن به سرویس؛ یک مسیر کوتاه برای کار بعدی.</p><div class="dashboard-context"><span>${icon('calendar-days')}${new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>${icon('refresh-cw')}دریافت داده: <time>${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</time></span></div></div><div class="welcome-actions"><span class="workspace-tag">${icon('shield-check')}فضای مدیریت UHM</span><button class="button secondary" id="admin-refresh" aria-label="به‌روزرسانی">${icon('refresh-cw')}به‌روزرسانی</button></div></section>
  ${metrics.length ? `<div class="metrics dashboard-metrics">${metrics.map((m, i) => `<article class="metric"><div class="metric-heading"><span>${m.label}</span><span class="metric-icon metric-icon-${i}">${icon(m.symbol)}</span></div><strong>${fa(m.value)}</strong><small>${m.detail}</small></article>`).join('')}</div>` : ''}
  <section class="dashboard-shortcuts" aria-label="دسترسی سریع">${can('license') ? `<button class="dashboard-action primary-action" id="quick-license">${icon('plus')}<span><b>صدور لایسنس</b><small>دسترسی جدید، با سطح دلخواه</small></span>${icon('arrow-up-left')}</button>` : ''}${can('content') ? `<button class="dashboard-action" id="quick-package">${icon('package-open')}<span><b>ساخت پکیج</b><small>فایل، نسخه و مراحل نصب</small></span>${icon('arrow-up-left')}</button>` : ''}${can('team.manage') ? action('team', 'تیم و دسترسی‌ها', 'کنترل دقیق مجوز همکاران', 'shield-check') : ''}${can('service.manage') ? action('service', 'کنترل سرویس', 'نگهداری و وضعیت عملیات', 'sliders-horizontal') : ''}</section>
  <div class="dashboard-grid dashboard-insights">${
    can('licenses.read')
      ? `<section class="panel"><div class="section-heading"><div><p class="section-kicker">LICENSE OVERVIEW</p><h2>ترکیب اشتراک‌ها</h2></div><span class="subtle">${fa(licenses.length)} لایسنس</span></div><div class="tier-bars">${[
          'normal',
          'pro',
          'vip',
        ]
          .map((t) => {
            const count = licenses.filter((l) => l.tier === t).length;
            return `<div><div>${badge(t)}<b>${fa(count)} <small>لایسنس</small></b></div><progress aria-label="تعداد لایسنس ${t.toUpperCase()}" max="${Math.max(licenses.length, 1)}" value="${count}"></progress></div>`;
          })
          .join(
            '',
          )}</div><div class="panel-note">${icon('info')}تعداد لایسنس به‌معنی تعداد اشخاص احراز هویت‌شده نیست.</div></section>`
      : ''
  }
  <section class="panel attention-panel"><div class="section-heading"><div><p class="section-kicker">NEXT UP</p><h2>در یک نگاه</h2></div>${icon('layers-2')}</div><div class="attention-list">${can('content.read') ? `<button class="attention-row" data-open="packages"><span class="attention-icon">${icon('package')}</span><span><b>محتوای در حال آماده‌سازی</b><small>پیش‌نویس‌ها هنوز در کاتالوگ عمومی نیستند</small></span><strong>${fa(drafts)}</strong>${icon('chevron-left')}</button>` : ''}${can('licenses.read') ? `<button class="attention-row" data-open="licenses"><span class="attention-icon">${icon('clock-3')}</span><span><b>اشتراک‌های منقضی‌شده</b><small>برای بررسی اعتبار، پرونده را باز کنید</small></span><strong>${fa(expired)}</strong>${icon('chevron-left')}</button>` : ''}${can('errors.read') ? `<button class="attention-row" data-open="errors"><span class="attention-icon">${icon('triangle-alert')}</span><span><b>خطاهای نیازمند رسیدگی</b><small>بر اساس رویدادهای اخیر دریافتی</small></span><strong>${fa(openErrors)}</strong>${icon('chevron-left')}</button>` : ''}</div><div class="panel-note">${icon('radio')}${can('analytics.read') ? `${fa(reports.filter((r) => r.status === 'installed').length)} گزارش نصب موفق · ${fa(reports.filter((r) => r.status === 'failed').length)} گزارش نصب ناموفق` : 'اطلاعات این صفحه مطابق مجوزهای حساب شماست.'}</div></section></div>
  ${can('audit.read') ? `<section class="panel dashboard-activity"><div class="section-heading"><div><p class="section-kicker">ACTIVITY LOG</p><h2>آخرین فعالیت‌ها</h2></div><button class="text-button" data-open="logs">همه رویدادها ${icon('arrow-up-left')}</button></div>${eventTable([...events].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6))}</section>` : ''}`;
  el.querySelector('#admin-refresh')!.addEventListener('click', () => void refreshPage());
  el.querySelector('#quick-license')?.addEventListener('click', generateDialog);
  el.querySelector('#quick-package')?.addEventListener('click', () => editPackage());
  el.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
    b.addEventListener('click', () =>
      document.querySelector<HTMLButtonElement>(`[data-nav="${b.dataset.open}"]`)?.click(),
    ),
  );
}
function licenses(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">ACCESS MANAGEMENT / 02</p><h1>هر دسترسی، یک هویت.</h1><p class="muted">تولید، تمدید و کنترل لایسنس‌های تک‌دستگاهی.</p></div>${can('license') ? `<button class="button" id="generate">${icon('plus')}تولید لایسنس</button>` : ''}</div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="license-search" placeholder="جست‌وجوی نام، شناسه یا برچسب…"></label><select id="license-filter" aria-label="فیلتر وضعیت لایسنس"><option value="all">همه وضعیت‌ها</option>${Object.entries(
    statuses,
  )
    .slice(0, 4)
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join(
      '',
    )}<option value="scheduled">شروع در آینده</option><option value="expired">منقضی‌شده</option><option value="archived">بایگانی‌شده</option></select></div><div class="panel table-panel" id="license-table"></div>`;
  const render = () => {
    const q = (el.querySelector('#license-search') as HTMLInputElement).value.toLowerCase(),
      filter = (el.querySelector('#license-filter') as HTMLSelectElement).value;
    const items = overview.licenses.filter(
      (l) =>
        `${l.id} ${l.prefix} ${l.display_name || ''} ${(l.tags || []).join(' ')}`
          .toLowerCase()
          .includes(q) &&
        (filter === 'archived' ? !!l.archived : !l.archived) &&
        (filter === 'all' || filter === 'archived' || licenseState(l) === filter),
    );
    el.querySelector('#license-table')!.innerHTML = items.length
      ? `<div class="table-scroll"><table><thead><tr><th>شناسه / پیشوند</th><th>سطح</th><th>وضعیت</th><th>اعتبار تا</th><th>دستگاه</th><th>عملیات</th></tr></thead><tbody>${items.map((l) => `<tr><td><b>${esc(l.display_name || 'بدون نام')}</b><small class="cell-sub"><code>${esc(l.prefix)}••••</code></small><small class="cell-sub" dir="ltr">${l.id.slice(0, 8)}</small></td><td>${badge(l.tier)}</td><td><span class="status ${l.status}">${statuses[licenseState(l)] || 'نامشخص'}</span></td><td>${date(l.expires_at)}<small class="cell-sub">${fa(l.duration_days)} روز از فعال‌سازی</small></td><td>${l.device_thumbprint ? `<span class="device-dot"></span><code>${esc(l.device_thumbprint.slice(0, 8))}</code>` : '—'}</td><td><button class="text-button" data-license="${l.id}">پرونده ${icon('chevron-left')}</button></td></tr>`).join('')}</tbody></table></div>`
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
    `<p class="muted">کد کامل فقط یک‌بار نمایش داده می‌شود. اگر تاریخ تقویمی وارد نکنید، شروع اعتبار در اولین فعال‌سازی است.</p><form id="generate-form"><div class="form-grid">${field('سطح اشتراک', '<select name="tier"><option value="normal">Normal</option><option value="pro">Pro</option><option value="vip">VIP</option></select>')}${field('اعتبار (روز)', '<input name="duration_days" type="number" min="1" max="1095" value="30" required>')}${field('تعداد', '<input name="count" type="number" min="1" max="100" value="1" required>')}${overview.capabilities?.includes('license-window-v1') ? field('شروع مجاز فعال‌سازی (زمان محلی، اختیاری)', '<input name="starts_at" type="datetime-local">') + field('انقضای ثابت تقویمی (زمان محلی، اختیاری)', '<input name="expires_at" type="datetime-local">') : ''}</div><div class="notice">${icon('monitor')}هر لایسنس فقط یک دستگاه فعال دارد.</div><button class="button full" type="submit">تولید و نمایش کدها</button></form>`,
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
          ...(overview.capabilities?.includes('license-window-v1')
            ? {
                starts_at: f.get('starts_at')
                  ? new Date(String(f.get('starts_at'))).toISOString()
                  : null,
                expires_at: f.get('expires_at')
                  ? new Date(String(f.get('expires_at'))).toISOString()
                  : null,
              }
            : {}),
        },
        token,
      );
      d.close();
      const out = modal(
        'کدهای شما آماده‌اند',
        `<p class="muted">این کدها در فهرست مدیریت قابل بازیابی نیستند. اکنون آن‌ها را ذخیره کنید.</p><textarea aria-label="کدهای لایسنس صادرشده" id="codes" rows="7" readonly dir="ltr">${esc(codes.join('\n'))}</textarea><div class="actions"><button class="button" id="download-codes">${icon('download')}خروجی CSV</button><button class="button secondary" id="copy-codes">کپی کدها</button></div>`,
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
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">CONTENT STUDIO / 03</p><h1>${versions ? 'انتشار بعدی، دقیق‌تر.' : 'محتوا را شما می‌سازید.'}</h1><p class="muted">${versions ? 'نسخه، تغییرات و چرخهٔ انتشار پکیج‌ها.' : 'چند فایل، چند مرحله؛ بدون نیاز به ساخت دوباره لانچر.'}</p></div><div class="actions">${overview.capabilities?.includes('package-admin-v1') && can('categories.manage') ? '<button class="button secondary" id="manage-categories">دسته‌بندی‌ها</button>' : ''}${can('content.create') ? '<button class="button" id="new-package">' + icon('plus') + 'پکیج جدید</button>' : ''}</div></div><div class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>پکیج</th><th>نسخه</th><th>سطح</th><th>وضعیت</th><th>فایل / پیش‌نیاز</th><th>عملیات</th></tr></thead><tbody>${overview.packages.map((p) => `<tr><td><div class="table-product"><img src="${esc(assetUrl(p.image))}" alt=""><span>${esc(p.name)}<small class="cell-sub" dir="ltr">${esc(p.slug)}</small></span></div></td><td><code>v${esc(p.version)}</code></td><td>${badge(p.tier)}</td><td><span class="status ${p.status}">${statuses[p.status]}</span></td><td>${can('content') ? fa(p.files.length) : 'محفوظ'} / ${fa(p.dependencies.length)}</td><td><button class="text-button" data-edit="${p.id}">${can('content') ? 'ویرایش / انتشار' : 'مشاهده'} ${icon('chevron-left')}</button></td></tr>`).join('')}</tbody></table></div></div><p class="fine-print">انتشار به فایل، هش و مراحل معتبر نیاز دارد. اعتبارسنجی سرور جای آزمون واقعی نصب را نمی‌گیرد. نسخهٔ منتشرشده تغییرناپذیر است.</p>`;
  if (!can('content.read'))
    el.querySelector('.table-panel')!.innerHTML = empty(
      'فهرست محتوا برای این حساب پنهان است',
      can('content')
        ? 'می‌توانید پکیج جدید بسازید؛ مشاهده پکیج‌های قبلی به مجوز جداگانه نیاز دارد.'
        : 'برای مشاهده و انتخاب پکیج‌ها از مالک مجوز مشاهده محتوا بخواهید.',
      'lock-keyhole',
    );
  else if (!overview.packages.length)
    el.querySelector('.table-panel')!.innerHTML = empty(
      'هنوز پکیجی ساخته نشده',
      'پس از ساخت اولین پیش‌نویس، فایل‌ها و چرخه انتشار اینجا مدیریت می‌شوند.',
    );
  el.querySelector('#manage-categories')?.addEventListener('click', () =>
    manageCategories(overview.categories || [], token, refreshPage),
  );
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
          `<h3>${esc(r.manifest.name)}</h3><p class="preserve muted">${esc(r.manifest.changelog)}</p><dl class="definition"><dt>تعداد فایل‌ها</dt><dd>${fa(r.manifest.files.length)}</dd><dt>مراحل نصب</dt><dd>${fa(r.manifest.steps.length)}</dd><dt>انتشار</dt><dd>${date(r.published_at)}</dd></dl>${(overview.capabilities?.includes('package-admin-v1') ? can('content.versions') : can('content')) ? '<button class="button full" id="fork-release">ساخت پیش‌نویس از این نسخه</button>' : ''}`,
        );
        d.querySelector('#fork-release')?.addEventListener('click', () => {
          void busy(d.querySelector('#fork-release')!, async () => {
            const current = overview.packages.find((p) => p.id === r.package_id);
            const parts = (current?.version || r.version).split('.').map(Number);
            parts[2]++;
            if (overview.capabilities?.includes('package-admin-v1')) {
              await api(
                `/admin/packages/${r.package_id}/restore`,
                {
                  release_version: r.version,
                  new_version: parts.join('.'),
                  expected_revision: current?.revision || 1,
                },
                token,
              );
              d.close();
              await refreshPage();
              toast(
                'نسخهٔ قبلی به صورت پیش‌نویس با شمارهٔ جدید بازگردانده شد؛ هنوز منتشر یا روی دستگاهی نصب نشده است.',
              );
            } else {
              d.close();
              editPackage({
                ...r.manifest,
                version: parts.join('.'),
                status: 'draft',
                released_at: null,
                scheduled_at: null,
              });
            }
          });
        });
      }),
  );
}

function editPackage(existing?: PackageSpec) {
  const writable = can(existing ? 'content.update' : 'content.create');
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
    `<div class="studio-intro"><span class="console-pill">MANIFEST STUDIO</span><h3>از لینک تا نصب؛ دقیق و قابل تکرار.</h3><p>فایل‌ها، رمز استخراج، پیش‌نیازها و مراحل نصب را جداگانه تنظیم کنید. خروجی انتشار تغییرناپذیر است.</p></div><form id="package-form" data-guard-discard><fieldset ${writable ? '' : 'disabled'}><div class="form-grid">${field('نام پکیج', `<input name="name" required minlength="2" maxlength="80" value="${esc(p.name)}">`)}${field('شناسه خوانا (انگلیسی)', `<input name="slug" required dir="ltr" pattern="[a-z0-9-]{2,64}" value="${esc(p.slug)}">`)}${field('نسخه', `<input name="version" required dir="ltr" pattern="[0-9]+\.[0-9]+\.[0-9]+" value="${esc(p.version)}">`)}${field('سطح دسترسی', `<select name="tier">${['normal', 'pro', 'vip'].map((t) => `<option ${p.tier === t ? 'selected' : ''} value="${t}">${t.toUpperCase()}</option>`).join('')}</select>`)}${field(
      'دسته‌بندی',
      `<select name="category">${Object.entries(category)
        .filter(
          ([id]) =>
            !overview.categories ||
            overview.categories.some((c) => c.id === id && (c.enabled || id === p.category)),
        )
        .map(
          ([v, l]) =>
            `<option value="${v}" ${p.category === v ? 'selected' : ''}>${esc(l)}</option>`,
        )
        .join('')}</select>`,
    )}${field('تصویر کاور (HTTPS یا تصویر داخلی)', `<input name="image" required dir="ltr" value="${esc(p.image)}" placeholder="https://… یا /images/01.jpg">`)}</div>${field('توضیح کوتاه', `<input name="short_description" maxlength="240" value="${esc(p.short_description || '')}">`)}<div class="form-grid">${field('نوع محتوا', `<select name="content_type">${['car', 'track', 'skin', 'python_app', 'lua_app', 'csp', 'ppfilter', 'pack'].map((k) => `<option value="${k}" ${(p.content_type || 'pack') === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${field('سازنده', `<input name="author" maxlength="120" value="${esc(p.author || '')}">`)}${field('برند', `<input name="brand" maxlength="120" value="${esc(p.brand || '')}">`)}${field('کانال انتشار', `<select name="channel"><option value="stable">عمومی</option><option value="test" ${p.channel === 'test' ? 'selected' : ''}>تست / مخفی از کاتالوگ عمومی</option></select>`)}${field('زمان انتشار (زمان محلی؛ اختیاری)', `<input name="scheduled_at" type="datetime-local" value="${p.scheduled_at ? new Date(Date.parse(p.scheduled_at) - new Date(p.scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">`)}</div>${field('برچسب‌ها (با کامای انگلیسی)', `<input name="tags" value="${esc((p.tags || []).join(', '))}">`)}${field('تصاویر اضافی HTTPS (هر خط یک لینک)', `<textarea name="images" dir="ltr">${esc((p.images || []).join('\n'))}</textarea>`)}${field('توضیحات', `<textarea name="description" minlength="10" maxlength="3000" required>${esc(p.description)}</textarea>`)}${field('تغییرات این نسخه', `<textarea name="changelog" maxlength="3000">${esc(p.changelog)}</textarea>`)}<h3 class="form-section">پیش‌نیازها</h3><div class="checks">${
      overview.packages
        .filter((q) => q.id !== p.id)
        .map(
          (q) =>
            `<label><input type="checkbox" name="dependencies" value="${q.id}" ${p.dependencies.includes(q.id) ? 'checked' : ''}>${esc(q.name)} ${badge(q.tier)}</label>`,
        )
        .join('') || '<span class="muted">پکیج دیگری وجود ندارد.</span>'
    }</div><div class="section-heading form-section"><h3>۲ · فایل‌ها و رمزهای استخراج</h3><button type="button" class="text-button" id="add-file">${icon('plus')}افزودن فایل</button></div><div id="file-rows"></div><div class="section-heading form-section"><h3>۳ · مراحل نصب به ترتیب اجرا</h3><button type="button" class="text-button" id="add-step">افزودن مرحله</button></div><div id="install-steps"></div><p class="studio-summary" id="studio-summary"></p><p class="fine-print">مقصد نسبت به ریشه بازی است. اجرای خودکار EXE ممنوع است. برای استخراج RAR/7z به استخراج‌کنندهٔ تأییدشده در نسخه Native نیاز است.</p></fieldset>${!writable ? '<p class="notice">این فرم فقط خواندنی است. جزئیات فایل و رمز طبق مجوز حساب پنهان می‌شوند؛ عملیات انتشار روی نسخه ذخیره‌شده سرور انجام می‌شود.</p>' : ''}<div class="actions studio-actions">${writable ? '<button class="button" type="submit">ذخیره پیش‌نویس</button>' : ''}${existing && p.status === 'draft' && hasPermission(overview.admin, 'content.publish') ? '<button type="button" class="button secondary" id="validate-package">اعتبارسنجی سرور</button><button type="button" class="button secondary" id="test-package">نصب تست روی این دستگاه</button><button type="button" class="button secondary" id="publish-package">انتشار نسخه</button>' : ''}${existing && p.status === 'published' && hasPermission(overview.admin, 'content.publish') ? '<button type="button" class="button secondary" id="archive-package">بایگانی</button>' : ''}</div></form>`,
    true,
  );
  if (existing && overview.capabilities?.includes('package-admin-v1') && can('content.delete')) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button danger-button';
    remove.textContent = 'حذف پکیج از کاتالوگ';
    d.querySelector('.studio-actions')!.append(remove);
    remove.onclick = () =>
      void busy(remove, async () => {
        const typed = window.prompt(
          `حذف منطقی پکیج با حفظ تاریخچه؛ فایل‌های نصب‌شده دست‌نخورده می‌مانند. برای تأیید شناسه را وارد کنید: ${p.slug}`,
        );
        if (typed === null) return;
        if (typed !== p.slug) throw new Error('شناسه تأیید مطابقت ندارد.');
        await api(
          `/admin/packages/${p.id}/delete`,
          { confirm_slug: typed, expected_revision: p.revision || 1 },
          token,
        );
        d.close();
        await refreshPage();
        toast('پکیج حذف منطقی شد؛ تاریخچه حفظ شد.');
      });
  }
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
    el.innerHTML = `<div class="section-heading"><b>فایل دانلود / جزء آرشیو</b><div class="actions"><button type="button" data-up aria-label="فایل بالاتر">↑</button><button type="button" data-down aria-label="فایل پایین‌تر">↓</button><button type="button" class="icon-button remove-file" aria-label="حذف فایل">${icon('trash-2')}</button></div></div><div class="form-grid">${field('نام دقیق فایل (مانند mod.part1.rar)', `<input data-f="name" required maxlength="100" value="${esc(file?.name || '')}" dir="ltr">`)}${field('فرمت', `<select data-f="format">${['zip', 'rar', '7z', 'file', 'exe'].map((f) => `<option ${file?.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}</div>${field('لینک مستقیم HTTPS', `<input data-f="url" type="url" required dir="ltr" value="${esc(file?.url || '')}" placeholder="https://…">`)}${field('لینک‌های جایگزین HTTPS (هر خط یک لینک؛ حداکثر ۵)', `<textarea data-f="mirrors" dir="ltr">${esc((file?.mirrors || []).join('\n'))}</textarea>`)}${field('SHA-256 (۶۴ کاراکتر)', `<input data-f="sha256" required pattern="[a-f0-9]{64}" dir="ltr" value="${esc(file?.sha256 || '')}">`)}<div class="form-grid">${field('حجم دقیق (بایت)', `<input data-f="size" type="number" min="1" required value="${file?.size || ''}">`)}${field('رمز آرشیو (اختیاری)', `<input data-f="archive_password" type="password" maxlength="256" autocomplete="new-password" dir="ltr" value="${esc(file?.archive_password || '')}">`)}</div><button type="button" class="button secondary" data-inspect>انتخاب فایل و محاسبهٔ هش / حجم</button><p class="fine-print">محاسبه روی دستگاه شماست؛ فایل آپلود نمی‌شود. رمز فقط به مدیر محتوا و دریافت‌کننده مجاز این پکیج داده می‌شود؛ از رمز حساب کاربری استفاده نکنید. برای آرشیو چندبخشی، همه بخش‌ها را با نام اصلی وارد و فقط بخش اول را در مرحله استخراج انتخاب کنید.</p>`;
    rows.append(el);
    el.querySelector<HTMLButtonElement>('[data-inspect]')!.onclick = function () {
      void busy(this as HTMLButtonElement, async () => {
        const result = await inspectArtifact();
        if (!result) return;
        (el.querySelector('[data-f=sha256]') as HTMLInputElement).value = result.sha256;
        (el.querySelector('[data-f=size]') as HTMLInputElement).value = String(result.size);
        const name = el.querySelector('[data-f=name]') as HTMLInputElement;
        if (!name.value) name.value = result.name;
        refreshFiles();
        toast('هش و حجم دقیق، بدون آپلود محاسبه شد.');
      });
    };
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
  const readManifest = () => {
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
    return pkg;
  };
  const wizard = mountPackageBuilder(d.querySelector('form')!, readManifest, overview.packages);
  d.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    void busy(d.querySelector('button[type=submit]')!, async () => {
      const pkg = readManifest();
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
      await requireContentV2();
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
      await api(
        `/admin/packages/${p.id}/publish`,
        overview.capabilities?.includes('package-admin-v1')
          ? { expected_revision: p.revision || 1 }
          : {},
        token,
      );
      d.close();
      toast('نسخه منتشر شد.');
      await refreshPage();
    });
  });
  d.querySelector<HTMLButtonElement>('#archive-package')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!window.confirm('پکیج از کاتالوگ حذف و بایگانی شود؟ تاریخچه نسخه‌ها محفوظ می‌ماند.'))
        return;
      await api(
        `/admin/packages/${p.id}/archive`,
        overview.capabilities?.includes('package-admin-v1')
          ? { expected_revision: p.revision || 1 }
          : {},
        token,
      );
      d.close();
      toast('پکیج بایگانی شد.');
      await refreshPage();
    });
  });
}
async function devices(el: HTMLElement) {
  const items: {
    id: string;
    tier: string;
    status: string;
    device_thumbprint: string | null;
    activated_at: string | null;
  }[] =
    can('devices.read') && overview.capabilities?.includes('user-profiles-v1')
      ? (await api('/admin/devices', undefined, token)).devices
      : overview.licenses.filter((l) => l.device_thumbprint);
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">DEVICE REGISTRY / 04</p><h1>یک لایسنس. یک دستگاه.</h1><p class="muted">اتصال‌ها بر اساس کلید دستگاه هستند، نه IP کاربر.</p></div></div><div class="panel table-panel">${items.length ? `<div class="table-scroll"><table><thead><tr><th>اثر انگشت کلید</th><th>اشتراک</th><th>فعال‌سازی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${items.map((l) => `<tr><td><code dir="ltr">${esc(l.device_thumbprint?.slice(0, 24))}…</code></td><td>${badge(l.tier)}</td><td>${date(l.activated_at)}</td><td><span class="status ${l.status}">${statuses[l.status] || 'نامشخص'}</span></td><td>${can('licenses.reset') ? `<button class="text-button" data-device="${l.id}">مدیریت اتصال</button>` : 'فقط مشاهده'}</td></tr>`).join('')}</tbody></table></div>` : empty('هنوز دستگاهی متصل نیست', 'با فعال‌سازی لایسنس در لانچر، دستگاه اینجا نمایش داده می‌شود.', 'monitor')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(
    (b) =>
      (b.onclick = () =>
        void busy(b, async () => {
          if (
            !window.confirm(
              'دستگاه این لایسنس آزاد شود؟ فعال‌سازی بعدی می‌تواند به دستگاه دیگری متصل شود.',
            )
          )
            return;
          await api(`/admin/licenses/${b.dataset.device}/reset`, {}, token);
          await refreshPage();
        })),
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
