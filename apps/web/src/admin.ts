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
  type ContactSettings,
  licenseState,
} from '../../../packages/contracts/src/index';
import { assetUrl } from './runtime';
import { api, supabase, requireContentV2 } from './api';
import { L, getLang, num, fmtDate, fmtTime, statusLabels, roleLabels } from './i18n';
import {
  esc,
  icon,
  decorate,
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
  isCurrent: () => boolean = () => true,
  onContactUpdated?: (contact: ContactSettings, configured: boolean) => void,
) {
  token = adminToken;
  refreshPage = reload;
  const data = await api<Overview>('/admin/overview', undefined, token);
  if (!isCurrent()) return;
  overview = data;
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
    contact: 'contact.manage',
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
  const rLabels = roleLabels();
  document.querySelectorAll('[data-admin-role]').forEach((el) => {
    el.textContent = rLabels[overview.admin.role] || L('مدیریت', 'Staff');
  });
  document.querySelectorAll<HTMLElement>('.nav-group').forEach((group) => {
    group.hidden = !group.querySelector('[data-nav]:not([hidden])');
  });
  if (
    await renderConsole(container, page, {
      data: overview,
      token,
      reload,
      onContactUpdated,
    })
  )
    return;
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
      label: L('کل لایسنس‌ها', 'Total Licenses'),
      detail: L('ثبت‌شده در سرویس', 'Registered in platform'),
      symbol: 'key-round',
    },
    {
      allowed: can('licenses.read'),
      value: active,
      label: L('اشتراک فعال', 'Active Entitlements'),
      detail: L('فعال و دارای اعتبار زمانی', 'Active & unexpired'),
      symbol: 'badge-check',
    },
    {
      allowed: can('content.read'),
      value: published,
      label: L('پکیج منتشرشده', 'Published Packages'),
      detail: `${num(drafts)} ${L('پیش‌نویس در فضای محتوا', 'drafts in studio')}`,
      symbol: 'package',
    },
    {
      allowed: can('errors.read'),
      value: openErrors,
      label: L('خطای رسیدگی‌نشده', 'Open Incidents'),
      detail: L('در رویدادهای دریافتی اخیر', 'From recent telemetry'),
      symbol: 'triangle-alert',
    },
  ].filter((m) => m.allowed);

  const arrow = getLang() === 'fa' ? 'arrow-up-left' : 'arrow-up-right';
  const chevron = getLang() === 'fa' ? 'chevron-left' : 'chevron-right';
  const action = (target: string, title: string, detail: string, symbol: string) =>
    `<button class="dashboard-action" data-open="${target}">${icon(symbol)}<span><b>${title}</b><small>${detail}</small></span>${icon(arrow)}</button>`;

  el.innerHTML = `<section class="dashboard-welcome"><div><div class="eyebrow" lang="en"><span class="eyebrow-line"></span>CONTROL CENTER</div><h1>${L('همه‌چیز، زیر کنترل.', 'Everything Under Control.')}</h1><p>${L('یک نگاه روشن به سرویس؛ یک مسیر کوتاه برای کار بعدی.', 'Real-time operational metrics, license issuance, and release controls.')}</p><div class="dashboard-context"><span>${icon('calendar-days')}${new Date().toLocaleDateString(getLang() === 'en' ? 'en-US' : 'fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>${icon('refresh-cw')}${L('دریافت داده:', 'Synced:')} <time>${fmtTime(new Date())}</time></span></div></div><div class="welcome-actions"><span class="workspace-tag">${icon('shield-check')}${L('فضای مدیریت لانچر', 'Control Room')}</span><button class="button secondary" id="admin-refresh" aria-label="${L('به‌روزرسانی', 'Refresh')}">${icon('refresh-cw')}${L('به‌روزرسانی', 'Refresh')}</button></div></section>
  ${metrics.length ? `<div class="metrics dashboard-metrics">${metrics.map((m, i) => `<article class="metric"><div class="metric-heading"><span>${m.label}</span><span class="metric-icon metric-icon-${i}">${icon(m.symbol)}</span></div><strong>${num(m.value)}</strong><small>${m.detail}</small></article>`).join('')}</div>` : ''}
  <section class="dashboard-shortcuts" aria-label="${L('دسترسی سریع', 'Quick actions')}">${can('license') ? `<button class="dashboard-action primary-action" id="quick-license">${icon('plus')}<span><b>${L('صدور لایسنس', 'Issue Licenses')}</b><small>${L('دسترسی جدید، با سطح دلخواه', 'Generate single-device keys')}</small></span>${icon(arrow)}</button>` : ''}${can('content') ? `<button class="dashboard-action" id="quick-package">${icon('package-open')}<span><b>${L('ساخت پکیج', 'New Package')}</b><small>${L('فایل، نسخه و مراحل نصب', 'Manifest, hashes & install steps')}</small></span>${icon(arrow)}</button>` : ''}${can('team.manage') ? action('team', L('تیم و دسترسی‌ها', 'Team & Access'), L('کنترل دقیق مجوز همکاران', 'Role & permission boundaries'), 'shield-check') : ''}${can('contact.manage') ? action('contact', L('تماس با ما', 'Contact Us Studio'), L('تنظیم کانال‌های پشتیبانی عمومی', 'Manage public channels'), 'mail') : ''}${can('service.manage') ? action('service', L('کنترل سرویس', 'Service Controls'), L('نگهداری و وضعیت عملیات', 'Maintenance & pauses'), 'sliders-horizontal') : ''}</section>
  <div class="dashboard-grid dashboard-insights">${
    can('licenses.read')
      ? `<section class="panel"><div class="section-heading"><div><p class="section-kicker">LICENSE OVERVIEW</p><h2>${L('ترکیب اشتراک‌ها', 'Tier Mix')}</h2></div><span class="subtle">${num(licenses.length)} ${L('لایسنس', 'licenses')}</span></div><div class="tier-bars">${[
          'normal',
          'pro',
          'vip',
        ]
          .map((t) => {
            const count = licenses.filter((l) => l.tier === t).length;
            return `<div><div>${badge(t)}<b>${num(count)} <small>${L('لایسنس', 'keys')}</small></b></div><progress aria-label="${L('تعداد لایسنس', 'License count for')} ${t.toUpperCase()}" max="${Math.max(licenses.length, 1)}" value="${count}"></progress></div>`;
          })
          .join(
            '',
          )}</div><div class="panel-note">${icon('info')}${L('تعداد لایسنس به‌معنی تعداد اشخاص احراز هویت‌شده نیست.', 'License count reflects issued keys, not unique verified individuals.')}</div></section>`
      : ''
  }
  <section class="panel attention-panel"><div class="section-heading"><div><p class="section-kicker">NEXT UP</p><h2>${L('در یک نگاه', 'At a Glance')}</h2></div>${icon('layers-2')}</div><div class="attention-list">${can('content.read') ? `<button class="attention-row" data-open="packages"><span class="attention-icon">${icon('package')}</span><span><b>${L('محتوای در حال آماده‌سازی', 'Draft Packages')}</b><small>${L('پیش‌نویس‌ها هنوز در کاتالوگ عمومی نیستند', 'Drafts remain hidden until published')}</small></span><strong>${num(drafts)}</strong>${icon(chevron)}</button>` : ''}${can('licenses.read') ? `<button class="attention-row" data-open="licenses"><span class="attention-icon">${icon('clock-3')}</span><span><b>${L('اشتراک‌های منقضی‌شده', 'Expired Licenses')}</b><small>${L('برای بررسی اعتبار، پرونده را باز کنید', 'Open dossier to review or extend')}</small></span><strong>${num(expired)}</strong>${icon(chevron)}</button>` : ''}${can('errors.read') ? `<button class="attention-row" data-open="errors"><span class="attention-icon">${icon('triangle-alert')}</span><span><b>${L('خطاهای نیازمند رسیدگی', 'Unresolved Incidents')}</b><small>${L('بر اساس رویدادهای اخیر دریافتی', 'Recent telemetry failures')}</small></span><strong>${num(openErrors)}</strong>${icon(chevron)}</button>` : ''}</div><div class="panel-note">${icon('radio')}${can('analytics.read') ? `${num(reports.filter((r) => r.status === 'installed').length)} ${L('گزارش نصب موفق', 'installed reports')} · ${num(reports.filter((r) => r.status === 'failed').length)} ${L('گزارش نصب ناموفق', 'failed reports')}` : L('اطلاعات این صفحه مطابق مجوزهای حساب شماست.', 'Visible panels reflect your active permissions.')}</div></section></div>
  ${can('audit.read') ? `<section class="panel dashboard-activity"><div class="section-heading"><div><p class="section-kicker">ACTIVITY LOG</p><h2>${L('آخرین فعالیت‌ها', 'Recent Audit Activity')}</h2></div><button class="text-button" data-open="logs">${L('همه رویدادها', 'All Audit Logs')} ${icon(arrow)}</button></div>${eventTable([...events].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6))}</section>` : ''}`;
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
  const sLabels = statusLabels();
  const chevron = getLang() === 'fa' ? 'chevron-left' : 'chevron-right';
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>ACCESS MANAGEMENT / 02</p><h1>${L('هر دسترسی، یک هویت.', 'Every Key, One Identity.')}</h1><p class="muted">${L('تولید، تمدید و کنترل لایسنس‌های تک‌دستگاهی.', 'Generate, window, extend, and manage hardware-bound licenses.')}</p></div>${can('license') ? `<button class="button" id="generate">${icon('plus')}${L('تولید لایسنس', 'Issue Licenses')}</button>` : ''}</div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="license-search" placeholder="${L('جست‌وجوی نام، شناسه یا برچسب…', 'Search display name, prefix, UUID, or tag…')}"></label><select id="license-filter" aria-label="${L('فیلتر وضعیت لایسنس', 'Filter license status')}"><option value="all">${L('همه وضعیت‌ها', 'All Statuses')}</option>${['active', 'unused', 'suspended', 'revoked', 'scheduled', 'expired'].map((v) => `<option value="${v}">${sLabels[v]}</option>`).join('')}<option value="archived">${L('بایگانی‌شده', 'Archived')}</option></select></div><div class="panel table-panel" id="license-table"></div>`;
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
      ? `<div class="table-scroll"><table><thead><tr><th>${L('شناسه / پیشوند', 'Identity / Prefix')}</th><th>${L('سطح', 'Tier')}</th><th>${L('وضعیت', 'Status')}</th><th>${L('اعتبار تا', 'Expires')}</th><th>${L('دستگاه', 'Device')}</th><th>${L('عملیات', 'Actions')}</th></tr></thead><tbody>${items.map((l) => `<tr><td><b>${esc(l.display_name || L('بدون نام', 'Unnamed'))}</b><small class="cell-sub"><code dir="ltr">${esc(l.prefix)}••••</code></small><small class="cell-sub" dir="ltr">${l.id.slice(0, 8)}</small></td><td>${badge(l.tier)}</td><td><span class="status ${l.status}">${sLabels[licenseState(l)] || L('نامشخص', 'Unknown')}</span></td><td>${fmtDate(l.expires_at)}<small class="cell-sub">${num(l.duration_days)} ${L('روز از فعال‌سازی', 'days from activation')}</small></td><td>${l.device_thumbprint ? `<span class="device-dot"></span><code dir="ltr">${esc(l.device_thumbprint.slice(0, 8))}</code>` : '—'}</td><td><button class="text-button" data-license="${l.id}">${L('پرونده', 'Dossier')} ${icon(chevron)}</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(
          L('لایسنسی پیدا نشد', 'No matching licenses'),
          L(
            'فیلتر را تغییر دهید یا یک لایسنس جدید بسازید.',
            'Adjust filters or generate a new batch.',
          ),
          'key-round',
        );
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
    L('تولید لایسنس', 'Issue New Licenses'),
    `<p class="muted">${L('کد کامل فقط یک‌بار نمایش داده می‌شود. اگر تاریخ تقویمی وارد نکنید، شروع اعتبار در اولین فعال‌سازی است.', 'Full keys are shown once only. Omit calendar dates to begin duration upon first device activation.')}</p><form id="generate-form"><div class="form-grid">${field(L('سطح اشتراک', 'Tier'), '<select name="tier"><option value="normal">Normal</option><option value="pro">Pro</option><option value="vip">VIP</option></select>')}${field(L('اعتبار (روز)', 'Duration (days)'), '<input name="duration_days" type="number" min="1" max="1095" value="30" required>')}${field(L('تعداد', 'Quantity'), '<input name="count" type="number" min="1" max="100" value="1" required>')}${overview.capabilities?.includes('license-window-v1') ? field(L('شروع مجاز فعال‌سازی (زمان محلی، اختیاری)', 'Allowed Start (local; optional)'), '<input name="starts_at" type="datetime-local">') + field(L('انقضای ثابت تقویمی (زمان محلی، اختیاری)', 'Fixed Expiration (local; optional)'), '<input name="expires_at" type="datetime-local">') : ''}</div><div class="notice">${icon('monitor')}${L('هر لایسنس فقط یک دستگاه فعال دارد.', 'Each license binds to one active hardware key.')}</div><button class="button full" type="submit">${L('تولید و نمایش کدها', 'Generate & Show Keys')}</button></form>`,
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
        L('کدهای شما آماده‌اند', 'Keys Issued'),
        `<p class="muted">${L('این کدها در فهرست مدیریت قابل بازیابی نیستند. اکنون آن‌ها را ذخیره کنید.', 'Raw keys cannot be recovered later from the database. Save or export now.')}</p><textarea aria-label="${L('کدهای لایسنس صادرشده', 'Issued license keys')}" id="codes" rows="7" readonly dir="ltr">${esc(codes.join('\n'))}</textarea><div class="actions"><button class="button" id="download-codes">${icon('download')}${L('خروجی CSV', 'Export CSV')}</button><button class="button secondary" id="copy-codes">${L('کپی کدها', 'Copy Keys')}</button></div>`,
      );
      out.querySelector('#copy-codes')!.addEventListener(
        'click',
        () =>
          void navigator.clipboard
            .writeText(codes.join('\n'))
            .then(() => toast(L('کدها کپی شدند.', 'Keys copied to clipboard.')))
            .catch(handleError),
      );
      out.querySelector('#download-codes')!.addEventListener('click', () => {
        const url = URL.createObjectURL(
          new Blob(['code\n' + codes.join('\n')], { type: 'text/csv' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'launcher-licenses.csv';
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
  const sLabels = statusLabels();
  const chevron = getLang() === 'fa' ? 'chevron-left' : 'chevron-right';
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>CONTENT STUDIO / 03</p><h1>${versions ? L('انتشار بعدی، دقیق‌تر.', 'Release Precision.') : L('محتوا را شما می‌سازید.', 'Content Studio.')}</h1><p class="muted">${versions ? L('نسخه، تغییرات و چرخهٔ انتشار پکیج‌ها.', 'Versions, changelogs, and release history.') : L('چند فایل، چند مرحله؛ بدون نیاز به ساخت دوباره لانچر.', 'Multi-file manifests, SHA-256 verification, and staged install steps.')}</p></div><div class="actions">${overview.capabilities?.includes('package-admin-v1') && can('categories.manage') ? `<button class="button secondary" id="manage-categories">${L('دسته‌بندی‌ها', 'Categories')}</button>` : ''}${can('content.create') ? '<button class="button" id="new-package">' + icon('plus') + L('پکیج جدید', 'New Package') + '</button>' : ''}</div></div><div class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>${L('پکیج', 'Package')}</th><th>${L('نسخه', 'Version')}</th><th>${L('سطح', 'Tier')}</th><th>${L('وضعیت', 'Status')}</th><th>${L('فایل / پیش‌نیاز', 'Files / Deps')}</th><th>${L('عملیات', 'Actions')}</th></tr></thead><tbody>${overview.packages.map((p) => `<tr><td><div class="table-product"><img src="${esc(assetUrl(p.image))}" alt=""><span>${esc(p.name)}<small class="cell-sub" dir="ltr">${esc(p.slug)}</small></span></div></td><td><code dir="ltr">v${esc(p.version)}</code></td><td>${badge(p.tier)}</td><td><span class="status ${p.status}">${sLabels[p.status]}</span></td><td>${can('content') ? num(p.files.length) : L('محفوظ', 'Redacted')} / ${num(p.dependencies.length)}</td><td><button class="text-button" data-edit="${p.id}">${can('content') ? L('ویرایش / انتشار', 'Edit / Publish') : L('مشاهده', 'Inspect')} ${icon(chevron)}</button></td></tr>`).join('')}</tbody></table></div></div><p class="fine-print">${L('انتشار به فایل، هش و مراحل معتبر نیاز دارد. اعتبارسنجی سرور جای آزمون واقعی نصب را نمی‌گیرد. نسخهٔ منتشرشده تغییرناپذیر است.', 'Publishing requires valid HTTPS artifacts, SHA-256 digests, and non-overlapping install steps. Published snapshots are immutable.')}</p>`;
  if (!can('content.read'))
    el.querySelector('.table-panel')!.innerHTML = empty(
      L('فهرست محتوا برای این حساب پنهان است', 'Package Directory Hidden'),
      can('content')
        ? L(
            'می‌توانید پکیج جدید بسازید؛ مشاهده پکیج‌های قبلی به مجوز جداگانه نیاز دارد.',
            'You can create new drafts; viewing existing manifests requires content.read.',
          )
        : L(
            'برای مشاهده و انتخاب پکیج‌ها از مالک مجوز مشاهده محتوا بخواهید.',
            'Request content.read permission from the platform owner.',
          ),
      'lock-keyhole',
    );
  else if (!overview.packages.length)
    el.querySelector('.table-panel')!.innerHTML = empty(
      L('هنوز پکیجی ساخته نشده', 'No packages created yet'),
      L(
        'پس از ساخت اولین پیش‌نویس، فایل‌ها و چرخه انتشار اینجا مدیریت می‌شوند.',
        'Create your first package draft to configure artifacts and publish releases.',
      ),
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
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>RELEASE ARCHIVE / 04</p><h1>${L('هر انتشار، یک نقطهٔ بازگشت.', 'Every Release, A Rollback Anchor.')}</h1><p class="muted">${L('نسخه‌های منتشرشده به‌صورت snapshot تغییرناپذیر نگهداری می‌شوند؛ این صفحه ۵۰۰ انتشار اخیر را نشان می‌دهد.', 'Published versions are stored as immutable release snapshots (showing up to 500 latest).')}</p></div></div><div class="panel">${releases.length ? `<div class="table-scroll"><table><thead><tr><th>${L('پکیج', 'Package')}</th><th>${L('نسخه', 'Version')}</th><th>${L('انتشار', 'Published')}</th><th>${L('تغییرات', 'Changelog')}</th><th>${L('عملیات', 'Actions')}</th></tr></thead><tbody>${releases.map((r, i) => `<tr><td>${esc(r.manifest.name)}</td><td><code dir="ltr">v${esc(r.version)}</code></td><td>${fmtDate(r.published_at)}</td><td><span class="release-notes">${esc(r.manifest.changelog || '—')}</span></td><td><button class="text-button" data-release="${i}">${L('جزئیات انتشار', 'Release Details')}</button></td></tr>`).join('')}</tbody></table></div>` : empty(L('هنوز انتشار واقعی ثبت نشده', 'No immutable releases yet'), L('پس از اتصال فایل و انتشار پکیج، snapshot نسخه در این بخش ذخیره می‌شود. پکیج‌های نمونه سابقه انتشار واقعی ندارند.', 'Published packages generate immutable release snapshots here.'), 'git-branch')}</div><div class="notice">${icon('info')}${L('ساخت پیش‌نویس نسخه جدید، آخرین نسخه منتشرشده را از کاتالوگ کاربران حذف نمی‌کند. بازگردانی فایل‌های نصب‌شده به نسخه قدیمی هنوز نیازمند جریان جداگانه است.', 'Drafting a newer version preserves the current published snapshot in the public catalog.')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-release]').forEach(
    (b) =>
      (b.onclick = () => {
        const r = releases[Number(b.dataset.release)];
        const d = modal(
          `${L('نسخه', 'Version')} ${r.version}`,
          `<h3>${esc(r.manifest.name)}</h3><p class="preserve muted">${esc(r.manifest.changelog)}</p><dl class="definition"><dt>${L('تعداد فایل‌ها', 'Files')}</dt><dd>${num(r.manifest.files.length)}</dd><dt>${L('مراحل نصب', 'Install Steps')}</dt><dd>${num(r.manifest.steps.length)}</dd><dt>${L('انتشار', 'Published')}</dt><dd>${fmtDate(r.published_at)}</dd></dl>${(overview.capabilities?.includes('package-admin-v1') ? can('content.versions') && overview.packages.some((p) => p.id === r.package_id) : can('content')) ? `<button class="button full" id="fork-release">${L('ساخت پیش‌نویس از این نسخه', 'Restore as New Draft')}</button>` : ''}`,
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
                L(
                  'نسخهٔ قبلی به صورت پیش‌نویس با شمارهٔ جدید بازگردانده شد؛ هنوز منتشر یا روی دستگاهی نصب نشده است.',
                  'Previous snapshot restored as a draft with incremented patch version.',
                ),
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
    existing ? L('استودیوی پکیج', 'Package Studio') : L('ساخت پکیج جدید', 'Create Package'),
    `<div class="studio-intro"><span class="console-pill">MANIFEST STUDIO</span><h3>${L('از لینک تا نصب؛ دقیق و قابل تکرار.', 'From Manifest to Atomic Install.')}</h3><p>${L('فایل‌ها، رمز استخراج، پیش‌نیازها و مراحل نصب را جداگانه تنظیم کنید. خروجی انتشار تغییرناپذیر است.', 'Configure remote artifacts, archive passwords, dependencies, and install steps cleanly.')}</p></div><form id="package-form" data-guard-discard><fieldset ${writable ? '' : 'disabled'}><div class="form-grid">${field(L('نام پکیج', 'Package Name'), `<input name="name" required minlength="2" maxlength="80" value="${esc(p.name)}">`)}${field(L('شناسه خوانا (انگلیسی)', 'Slug (lowercase)'), `<input name="slug" required dir="ltr" pattern="[a-z0-9-]{2,64}" value="${esc(p.slug)}">`)}${field(L('نسخه', 'Version (SemVer)'), `<input name="version" required dir="ltr" pattern="[0-9]+\.[0-9]+\.[0-9]+" value="${esc(p.version)}">`)}${field(L('سطح دسترسی', 'Tier'), `<select name="tier">${['normal', 'pro', 'vip'].map((t) => `<option ${p.tier === t ? 'selected' : ''} value="${t}">${t.toUpperCase()}</option>`).join('')}</select>`)}${field(
      L('دسته‌بندی', 'Category'),
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
    )}${field(L('تصویر کاور (HTTPS یا تصویر داخلی)', 'Cover Image (HTTPS or /images/01.jpg)'), `<input name="image" required dir="ltr" value="${esc(p.image)}" placeholder="https://… or /images/01.jpg">`)}</div>${field(L('توضیح کوتاه', 'Short Summary'), `<input name="short_description" maxlength="240" value="${esc(p.short_description || '')}">`)}<div class="form-grid">${field(L('نوع محتوا', 'Content Type'), `<select name="content_type">${['car', 'track', 'skin', 'python_app', 'lua_app', 'csp', 'ppfilter', 'pack'].map((k) => `<option value="${k}" ${(p.content_type || 'pack') === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${field(L('سازنده', 'Author'), `<input name="author" maxlength="120" value="${esc(p.author || '')}">`)}${field(L('برند', 'Brand'), `<input name="brand" maxlength="120" value="${esc(p.brand || '')}">`)}${field(L('کانال انتشار', 'Release Channel'), `<select name="channel"><option value="stable">${L('عمومی', 'Stable (Public)')}</option><option value="test" ${p.channel === 'test' ? 'selected' : ''}>${L('تست / مخفی از کاتالوگ عمومی', 'Test (Hidden)')}</option></select>`)}${field(L('زمان انتشار (زمان محلی؛ اختیاری)', 'Scheduled Release (local; optional)'), `<input name="scheduled_at" type="datetime-local" value="${p.scheduled_at ? new Date(Date.parse(p.scheduled_at) - new Date(p.scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">`)}</div>${field(L('برچسب‌ها (با کامای انگلیسی)', 'Tags (comma-separated)'), `<input name="tags" dir="ltr" value="${esc((p.tags || []).join(', '))}">`)}${field(L('تصاویر اضافی HTTPS (هر خط یک لینک)', 'Additional Gallery HTTPS URLs (one per line)'), `<textarea name="images" dir="ltr">${esc((p.images || []).join('\n'))}</textarea>`)}${field(L('توضیحات', 'Description'), `<textarea name="description" minlength="10" maxlength="3000" required>${esc(p.description)}</textarea>`)}${field(L('تغییرات این نسخه', 'Changelog'), `<textarea name="changelog" maxlength="3000">${esc(p.changelog)}</textarea>`)}<h3 class="form-section">${L('پیش‌نیازها', 'Dependencies')}</h3><div class="checks">${
      overview.packages
        .filter((q) => q.id !== p.id)
        .map(
          (q) =>
            `<label><input type="checkbox" name="dependencies" value="${q.id}" ${p.dependencies.includes(q.id) ? 'checked' : ''}>${esc(q.name)} ${badge(q.tier)}</label>`,
        )
        .join('') ||
      `<span class="muted">${L('پکیج دیگری وجود ندارد.', 'No other packages in workspace.')}</span>`
    }</div><div class="section-heading form-section"><h3>${L('۲ · فایل‌ها و رمزهای استخراج', '2 · Files & Archive Passwords')}</h3><button type="button" class="text-button" id="add-file">${icon('plus')}${L('افزودن فایل', 'Add File')}</button></div><div id="file-rows"></div><div class="section-heading form-section"><h3>${L('۳ · مراحل نصب به ترتیب اجرا', '3 · Ordered Install Steps')}</h3><button type="button" class="text-button" id="add-step">${L('افزودن مرحله', 'Add Step')}</button></div><div id="install-steps"></div><p class="studio-summary" id="studio-summary"></p><p class="fine-print">${L('مقصد نسبت به ریشه بازی است. اجرای خودکار EXE ممنوع است. برای استخراج RAR/7z به استخراج‌کنندهٔ تأییدشده در نسخه Native نیاز است.', 'Destinations resolve relative to the AC game root. Downloaded EXEs are never executed automatically.')}</p></fieldset>${!writable ? `<p class="notice">${L('این فرم فقط خواندنی است. جزئیات فایل و رمز طبق مجوز حساب پنهان می‌شوند؛ عملیات انتشار روی نسخه ذخیره‌شده سرور انجام می‌شود.', 'Read-only view: links and archive passwords are hidden by your permission set; publish validates the saved draft on the server.')}</p>` : ''}<div class="actions studio-actions">${writable ? `<button class="button" type="submit">${L('ذخیره پیش‌نویس', 'Save Draft')}</button>` : ''}${existing && p.status === 'draft' && hasPermission(overview.admin, 'content.publish') ? `<button type="button" class="button secondary" id="validate-package">${L('اعتبارسنجی سرور', 'Validate Draft')}</button><button type="button" class="button secondary" id="test-package">${L('نصب تست روی این دستگاه', 'Test Install on Device')}</button><button type="button" class="button secondary" id="publish-package">${L('انتشار نسخه', 'Publish Release')}</button>` : ''}${existing && p.status === 'published' && hasPermission(overview.admin, 'content.publish') ? `<button type="button" class="button secondary" id="archive-package">${L('بایگانی', 'Archive')}</button>` : ''}</div></form>`,
    true,
  );
  if (existing && overview.capabilities?.includes('package-admin-v1') && can('content.delete')) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button danger-button';
    remove.textContent = L('حذف پکیج از کاتالوگ', 'Soft-Delete Package');
    d.querySelector('.studio-actions')!.append(remove);
    remove.onclick = () =>
      void busy(remove, async () => {
        const typed = window.prompt(
          L(
            `حذف منطقی پکیج با حفظ تاریخچه؛ فایل‌های نصب‌شده دست‌نخورده می‌مانند. برای تأیید شناسه را وارد کنید: ${p.slug}`,
            `Soft-delete this package while keeping release history? Type exact slug to confirm: ${p.slug}`,
          ),
        );
        if (typed === null) return;
        if (typed !== p.slug)
          throw new Error(L('شناسه تأیید مطابقت ندارد.', 'Confirmation slug did not match.'));
        await api(
          `/admin/packages/${p.id}/delete`,
          { confirm_slug: typed, expected_revision: p.revision || 1 },
          token,
        );
        d.close();
        await refreshPage();
        toast(L('پکیج حذف منطقی شد؛ تاریخچه حفظ شد.', 'Package soft-deleted cleanly.'));
      });
  }
  const rows = d.querySelector('#file-rows')!;
  const stepsEl = d.querySelector('#install-steps')!;
  function refreshFiles() {
    const files = [...rows.querySelectorAll<HTMLElement>('.file-row')].map((el) => ({
      id: el.dataset.id!,
      name:
        (el.querySelector('[data-f=name]') as HTMLInputElement).value ||
        L('فایل بدون نام', 'Unnamed file'),
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
      `${num(files.length)} ${L('فایل', 'files')} · ${num(stepsEl.children.length)} ${L('مرحله', 'steps')} · ${(bytes / 1e6).toFixed(1)} MB · ${num(encrypted)} ${L('رمز آرشیو', 'encrypted')}`;
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
    el.innerHTML = `<div class="section-heading"><b>${L('مرحله نصب', 'Install Step')}</b><div class="actions"><button type="button" data-up aria-label="${L('مرحله بالاتر', 'Move up')}">↑</button><button type="button" data-down aria-label="${L('مرحله پایین‌تر', 'Move down')}">↓</button><button type="button" data-remove aria-label="${L('حذف مرحله', 'Remove step')}">${icon('trash-2')}</button></div></div><div class="form-grid">${field(L('فایل منبع', 'Source File'), '<select data-step-file required></select>')}${field(L('عملیات', 'Action'), `<select data-step="action"><option value="extract" ${step?.action === 'extract' ? 'selected' : ''}>${L('استخراج آرشیو', 'Extract Archive')}</option><option value="copy" ${step?.action === 'copy' ? 'selected' : ''}>${L('کپی فایل', 'Copy File')}</option></select>`)}${field(L('مسیر نسبی مقصد', 'Relative Destination'), `<input data-step="destination" required dir="ltr" value="${esc(step?.destination || 'extension')}">`)}${field(L('زیرپوشه منبع آرشیو (اختیاری)', 'Archive Subfolder (optional)'), `<input data-step="source_subdir" dir="ltr" value="${esc(step?.source_subdir || '')}" placeholder="wrapper/content/cars">`)}${field(L('وابستگی مراحل (شناسه‌ها با کاما؛ باید بالاتر باشند)', 'Depends on Step IDs (comma-separated)'), `<input data-step="depends_on" dir="ltr" value="${esc((step?.depends_on || []).join(', '))}">`)}<small class="muted" dir="ltr">Step ID: ${esc(el.dataset.id!)}</small>${field(L('فایل موجود', 'Conflict Policy'), `<select data-step="overwrite"><option value="backup">${L('بکاپ و جایگزینی', 'Backup & Replace')}</option><option value="fail" ${step?.overwrite === 'fail' ? 'selected' : ''}>${L('توقف در صورت تداخل', 'Abort on Conflict')}</option></select>`)}</div>`;
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
    el.innerHTML = `<div class="section-heading"><b>${L('فایل دانلود / جزء آرشیو', 'Artifact / Archive Volume')}</b><div class="actions"><button type="button" data-up aria-label="${L('فایل بالاتر', 'Move up')}">↑</button><button type="button" data-down aria-label="${L('فایل پایین‌تر', 'Move down')}">↓</button><button type="button" class="icon-button remove-file" aria-label="${L('حذف فایل', 'Remove file')}">${icon('trash-2')}</button></div></div><div class="form-grid">${field(L('نام دقیق فایل (مانند mod.part1.rar)', 'Exact Filename (e.g. mod.part1.rar)'), `<input data-f="name" required maxlength="100" value="${esc(file?.name || '')}" dir="ltr">`)}${field(L('فرمت', 'Format'), `<select data-f="format">${['zip', 'rar', '7z', 'file', 'exe'].map((f) => `<option ${file?.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}</div>${field(L('لینک مستقیم HTTPS', 'Direct HTTPS URL'), `<input data-f="url" type="url" required dir="ltr" value="${esc(file?.url || '')}" placeholder="https://…">`)}${field(L('لینک‌های جایگزین HTTPS (هر خط یک لینک؛ حداکثر ۵)', 'Mirror HTTPS URLs (up to 5, one per line)'), `<textarea data-f="mirrors" dir="ltr">${esc((file?.mirrors || []).join('\n'))}</textarea>`)}${field(L('SHA-256 (۶۴ کاراکتر)', 'SHA-256 Digest (64 hex chars)'), `<input data-f="sha256" required pattern="[a-f0-9]{64}" dir="ltr" value="${esc(file?.sha256 || '')}">`)}<div class="form-grid">${field(L('حجم دقیق (بایت)', 'Exact Size (bytes)'), `<input data-f="size" type="number" min="1" required value="${file?.size || ''}">`)}${field(L('رمز آرشیو (اختیاری)', 'Archive Password (optional)'), `<input data-f="archive_password" type="password" maxlength="256" autocomplete="new-password" dir="ltr" value="${esc(file?.archive_password || '')}">`)}</div><button type="button" class="button secondary" data-inspect>${L('انتخاب فایل و محاسبهٔ هش / حجم', 'Inspect Local File (SHA-256 / Size)')}</button><p class="fine-print">${L('محاسبه روی دستگاه شماست؛ فایل آپلود نمی‌شود. رمز فقط به مدیر محتوا و دریافت‌کننده مجاز این پکیج داده می‌شود؛ از رمز حساب کاربری استفاده نکنید. برای آرشیو چندبخشی، همه بخش‌ها را با نام اصلی وارد و فقط بخش اول را در مرحله استخراج انتخاب کنید.', 'Checksum computes locally without uploading files. For multi-part archives, add all parts with exact filenames and target only part 1 in the extract step.')}</p>`;
    rows.append(el);
    el.querySelector<HTMLButtonElement>('[data-inspect]')!.onclick = function () {
      void busy(this as HTMLButtonElement, async () => {
        const result = await inspectArtifact();
        if (!result) return;
        (el.querySelector('[data-f=sha256]') as HTMLInputElement).value = result.sha256;
        (el.querySelector('[data-f=size]') as HTMLInputElement).value = String(result.size);
        const name = el.querySelector('[data-f=name]') as HTMLInputElement;
        if (!name.value) name.value = result.name;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        refreshFiles();
        toast(L('هش و حجم دقیق، بدون آپلود محاسبه شد.', 'Local SHA-256 & byte size calculated.'));
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
      let pkg: PackageSpec;
      try {
        pkg = readManifest();
      } catch {
        wizard.show(3);
        throw new Error(
          L(
            'پکیج ذخیره نشد؛ خطاهای مرحلهٔ بازبینی را اصلاح کنید.',
            'Draft not saved; fix manifest errors shown in Review.',
          ),
        );
      }
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
      toast(
        L(
          'پیش‌نویس ذخیره شد؛ برای انتشار دوباره آن را باز کنید.',
          'Draft saved; reopen to validate or publish.',
        ),
      );
      await refreshPage();
    });
  };
  d.querySelector<HTMLButtonElement>('#test-package')?.addEventListener('click', function () {
    void busy(this, async () => {
      if (!native)
        throw new Error(
          L(
            'تست نصب واقعی فقط در برنامه ویندوز و با لایسنس فعال همان دستگاه انجام می‌شود.',
            'Test installation runs only in the Windows desktop client with an active device license.',
          ),
        );
      if (
        !window.confirm(
          L(
            'نسخه ذخیره‌شده روی مسیر واقعی انتخاب‌شده نصب شود؟ بهتر است یک کپی آزمایشی بازی را انتخاب کنید. پیش از اعمال، فهرست فایل‌ها تأیید خواهد شد.',
            'Install saved draft onto the selected Assetto Corsa directory? Prefer a test copy; you will review exact files before commit.',
          ),
        )
      )
        return;
      const grant = localStore.getItem('uhm-grant');
      if (!grant)
        throw new Error(
          L('ابتدا لایسنس همین دستگاه را فعال کنید.', 'Activate a device license first.'),
        );
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
        L(
          `ساختار ذخیره‌شده معتبر است؛ ${result.files} فایل و ${result.steps} مرحله. این آزمون، نصب واقعی نیست.`,
          `Saved manifest validated: ${result.files} files, ${result.steps} steps. Not a live archive test.`,
        ),
      );
    });
  });
  d.querySelector<HTMLButtonElement>('#publish-package')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (
        !window.confirm(
          L(
            'نسخه ذخیره‌شده با فایل‌ها و مراحل فعلی منتشر شود؟ تغییرات ذخیره‌نشده این فرم منتشر نمی‌شوند.',
            'Publish the last saved draft? Unsaved form edits are excluded.',
          ),
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
      toast(L('نسخه منتشر شد.', 'Package published.'));
      await refreshPage();
    });
  });
  d.querySelector<HTMLButtonElement>('#archive-package')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (
        !window.confirm(
          L(
            'پکیج از کاتالوگ حذف و بایگانی شود؟ تاریخچه نسخه‌ها محفوظ می‌ماند.',
            'Archive this package from public catalog? Release history stays intact.',
          ),
        )
      )
        return;
      await api(
        `/admin/packages/${p.id}/archive`,
        overview.capabilities?.includes('package-admin-v1')
          ? { expected_revision: p.revision || 1 }
          : {},
        token,
      );
      d.close();
      toast(L('پکیج بایگانی شد.', 'Package archived.'));
      await refreshPage();
    });
  });
}

async function devices(el: HTMLElement) {
  const sLabels = statusLabels();
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
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>DEVICE REGISTRY / 04</p><h1>${L('یک لایسنس. یک دستگاه.', 'One License. One Hardware Key.')}</h1><p class="muted">${L('اتصال‌ها بر اساس کلید دستگاه هستند، نه IP کاربر.', 'Bindings rely on cryptographic P-256 device thumbprints, not user IP addresses.')}</p></div></div><div class="panel table-panel">${items.length ? `<div class="table-scroll"><table><thead><tr><th>${L('اثر انگشت کلید', 'Key Thumbprint')}</th><th>${L('اشتراک', 'Tier')}</th><th>${L('فعال‌سازی', 'Activated')}</th><th>${L('وضعیت', 'Status')}</th><th>${L('عملیات', 'Actions')}</th></tr></thead><tbody>${items.map((l) => `<tr><td><code dir="ltr">${esc(l.device_thumbprint?.slice(0, 24))}…</code></td><td>${badge(l.tier)}</td><td>${fmtDate(l.activated_at)}</td><td><span class="status ${l.status}">${sLabels[l.status] || L('نامشخص', 'Unknown')}</span></td><td>${can('licenses.reset') ? `<button class="text-button" data-device="${l.id}">${L('مدیریت اتصال', 'Release Binding')}</button>` : L('فقط مشاهده', 'View only')}</td></tr>`).join('')}</tbody></table></div>` : empty(L('هنوز دستگاهی متصل نیست', 'No bound devices yet'), L('با فعال‌سازی لایسنس در لانچر، دستگاه اینجا نمایش داده می‌شود.', 'Bound hardware thumbprints appear here after license activation.'), 'monitor')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(
    (b) =>
      (b.onclick = () =>
        void busy(b, async () => {
          if (
            !window.confirm(
              L(
                'دستگاه این لایسنس آزاد شود؟ فعال‌سازی بعدی می‌تواند به دستگاه دیگری متصل شود.',
                'Release this hardware binding? The next activation can bind to a different device.',
              ),
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
    ? `<div class="table-scroll"><table><thead><tr><th>${L('رویداد', 'Event')}</th><th>${L('عامل', 'Actor')}</th><th>${L('هدف', 'Target')}</th><th>${L('زمان', 'Timestamp')}</th></tr></thead><tbody>${events.map((e) => `<tr><td><code dir="ltr">${esc(e.action)}</code></td><td><code dir="ltr">${esc(e.actor.slice(0, 14))}</code></td><td><code dir="ltr">${esc(e.target.slice(0, 16))}</code></td><td>${fmtDate(e.created_at)} <small>${fmtTime(e.created_at)}</small></td></tr>`).join('')}</tbody></table></div>`
    : empty(
        L('رویدادی ثبت نشده', 'No audit events recorded'),
        L(
          'عملیات واقعی پنل در این بخش ثبت می‌شوند.',
          'Control room mutations are recorded here atomically.',
        ),
        'scroll-text',
      );
}

function logs(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>AUDIT TRAIL / 05</p><h1>${L('هیچ تغییری بی‌ردپا نیست.', 'Every Change Leaves a Trace.')}</h1><p class="muted">${L('تاریخچهٔ عملیات؛ بدون ثبت کد کامل لایسنس یا کلید خصوصی.', 'Immutable operational trail without raw license codes or private keys.')}</p></div></div><section class="panel">${eventTable(overview.events)}</section>`;
}

export function loginDialog(demo: boolean, onSuccess: (token: string) => void) {
  const d = modal(
    L('ورود به اتاق کنترل', 'Control Room Sign-In'),
    `<p class="muted">${demo ? L('محیط توسعه: ورود نمایشی به داده‌های محلی. این ورود در نسخه عملیاتی وجود ندارد.', 'Local sandbox mode: demo owner session for browser preview only.') : L('ورود مدیران با Supabase Auth و تأیید دومرحله‌ای.', 'Operator sign-in via Supabase Auth + TOTP MFA.')}</p>${demo ? `<button class="button full" id="demo-admin">${L('ورود به پنل نمایشی', 'Enter Demo Control Room')}</button>` : `<form id="admin-login">${field(L('ایمیل', 'Email'), '<input name="email" type="email" required dir="ltr" autocomplete="username">')}${field(L('رمز عبور', 'Password'), '<input name="password" type="password" required dir="ltr" autocomplete="current-password">')}<button class="button full" type="submit">${L('ورود امن', 'Sign In')}</button></form>`}`,
  );
  d.querySelector('.modal-body')?.insertAdjacentHTML(
    'afterbegin',
    `<section class="license-login-panel"><div class="console-pill">DEVICE-BOUND ADMIN</div><h3>${L('ورود با لایسنس مدیریت', 'Device-Bound License Sign-In')}</h3><p class="muted">${L('کدی که مالک برای شما دسترسی داده است؛ همین لایسنس در برنامه هم قابل استفاده است.', 'Sign in using a staff-assigned license bound to this device key.')}</p><form id="license-admin-login">${field(L('کد لایسنس (اگر قبلاً فعال کرده‌اید، خالی بگذارید)', 'License Key (leave blank if already activated on this device)'), '<input name="license_code" dir="ltr" autocomplete="off" placeholder="UHM-…">')}<button class="button full" type="submit">${L('ورود با لایسنس این دستگاه', 'Sign In with Device License')}</button></form></section>`,
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
      if (!supabase)
        throw new Error(
          L('تنظیمات Supabase برای پنل وارد نشده است.', 'Supabase credentials are not configured.'),
        );
      const f = new FormData(e.target as HTMLFormElement);
      const { error } = await supabase.auth.signInWithPassword({
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      if (error) throw new Error(L('ورود ناموفق بود.', 'Sign-in failed.'));
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const factor = factors.totp.find((f) => f.status === 'verified');
      if (!factor)
        throw new Error(
          L(
            'ابتدا MFA مدیر را در فرایند راه‌اندازی امن ثبت کنید. دسترسی مدیریتی بدون MFA داده نمی‌شود.',
            'Verified TOTP MFA enrollment is required before admin sign-in.',
          ),
        );
      d.close();
      const m = modal(
        L('تأیید دومرحله‌ای', 'Two-Factor Verification'),
        `<form id="mfa-form">${field(L('کد برنامه احراز هویت', 'Authenticator 6-digit Code'), '<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required dir="ltr" autocomplete="one-time-code">')}<button class="button full" type="submit">${L('تأیید', 'Verify')}</button></form>`,
      );
      m.querySelector('form')!.onsubmit = (e) => {
        e.preventDefault();
        void busy(m.querySelector('button[type=submit]')!, async () => {
          const code = String(new FormData(e.target as HTMLFormElement).get('code'));
          const { error } = await supabase!.auth.mfa.challengeAndVerify({
            factorId: factor.id,
            code,
          });
          if (error) throw new Error(L('کد معتبر نیست.', 'Invalid verification code.'));
          const { data } = await supabase!.auth.getSession();
          m.close();
          sessionStore.removeItem('uhm-admin-mode');
          onSuccess(data.session!.access_token);
        });
      };
    });
  });
}
