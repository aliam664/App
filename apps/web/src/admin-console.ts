import { api } from './api';
import {
  hasPermission,
  Permission,
  rolePermissions,
  accessPermissions,
  type CustomRole,
  defaultService,
  type Admin,
  type AdminAccess,
  type License,
  type TelemetryEvent,
  type ServiceSettings,
} from '../../../packages/contracts/src/index';
import { esc, icon, fa, date, badge, modal, field, busy, toast, decorate, empty } from './ui';
type LicenseView = Omit<License, 'code_hash'>;
export type ConsoleData = {
  admin: Admin;
  capabilities?: string[];
  licenses: LicenseView[];
  telemetry?: TelemetryEvent[];
  service?: ServiceSettings | null;
  packages: { id: string; name: string }[];
};
type Context = { data: ConsoleData; token: string; reload: () => Promise<void> };
const roles: Record<string, string> = {
  owner: 'مالک اصلی',
  license_manager: 'مدیر لایسنس',
  content_manager: 'مدیر محتوا',
  support: 'پشتیبان',
  viewer: 'مشاهده‌گر',
};
const permissionLabels: Record<Permission, string> = {
  'licenses.read': 'مشاهده پرونده لایسنس',
  'licenses.create': 'صدور لایسنس',
  'licenses.update': 'ویرایش نام، توضیح و سطح',
  'licenses.suspend': 'تعلیق و رفع تعلیق',
  'licenses.revoke': 'لغو دائمی',
  'licenses.reset': 'آزادسازی دستگاه',
  'licenses.extend': 'تمدید اعتبار',
  'licenses.archive': 'بایگانی',
  'content.read': 'مشاهده محتوا',
  'content.write': 'مجوز ترکیبی قدیمی: ساخت و ویرایش محتوا',
  'content.create': 'ساخت پکیج جدید',
  'content.update': 'ویرایش پکیج و فایل‌های دانلود',
  'content.delete': 'حذف منطقی پکیج؛ حفظ سابقه',
  'content.versions': 'ساخت نسخهٔ جدید از انتشار قبلی',
  'categories.manage': 'مدیریت دسته‌بندی‌ها',
  'users.read': 'مشاهده پروفایل کاربران',
  'users.manage': 'ویرایش اطلاعات کاربران؛ نه اعتبار لایسنس',
  'devices.read': 'مشاهده دستگاه‌های متصل',
  'roles.manage': 'ساخت و ویرایش نقش‌های سفارشی',
  'content.publish': 'انتشار و بایگانی محتوا',
  'analytics.read': 'مشاهده تحلیل عملکرد',
  'errors.read': 'مشاهده خطاها',
  'errors.resolve': 'رسیدگی به خطاها',
  'team.manage': 'واگذاری دسترسی مدیران',
  'service.manage': 'کنترل نگهداری سرویس',
  'audit.read': 'مشاهده ردپای مدیریتی',
};
const eventLabels: Record<string, string> = {
  app_open: 'اجرای برنامه',
  download_started: 'شروع دانلود',
  download_completed: 'دانلود فایل تأییدشده',
  package_download_completed: 'دانلود کامل پکیج',
  download_failed: 'خطای دانلود',
  install_started: 'شروع نصب',
  install_completed: 'نصب تأییدشده',
  install_failed: 'خطای نصب',
  app_error: 'خطای برنامه',
};
const errors: Record<string, string> = {
  HASH_MISMATCH: 'هش فایل با نسخه منتشرشده مطابقت ندارد',
  DISK_FULL: 'فضای خالی کافی نیست',
  ARCHIVE_PASSWORD_OR_CORRUPT: 'رمز آرشیو نادرست است یا فایل خراب/پشتیبانی‌نشده است',
  DOWNLOAD_FAILED: 'ارتباط دانلود یا دریافت فایل ناموفق بود',
  INSTALL_FAILED: 'موتور نصب عملیات را کامل نکرد',
  RECOVERY_REQUIRED: 'نصب به بررسی و بازیابی نیاز دارد',
};
const can = (c: Context, p: Permission) => hasPermission(c.data.admin, p);
const heading = (over: string, title: string, description: string) =>
  `<div class="page-title"><div><p class="eyebrow">${over}</p><h1>${title}</h1><p class="muted">${description}</p></div><span class="console-pill">${icon('shield-check')} ${roles['owner'] && 'UHM CONTROL'}</span></div>`;
function activityTable(events: TelemetryEvent[], packages: Context['data']['packages']) {
  return events.length
    ? `<div class="table-scroll"><table><thead><tr><th>فعالیت / نتیجه</th><th>پکیج / نسخه</th><th>فایل / میزبان</th><th>زمان وقوع</th><th>دریافت سرور</th></tr></thead><tbody>${events.map((e) => `<tr><td><span class="event-state ${e.type.includes('failed') || e.type === 'app_error' ? 'is-error' : ''}">${esc(eventLabels[e.type])}</span><small class="cell-sub">${esc(errors[e.error_code || ''] || e.error_code || '')}</small></td><td>${esc(packages.find((p) => p.id === e.package_id)?.name || '—')}<small class="cell-sub" dir="ltr">${esc(e.version || '')}</small></td><td><code>${esc(e.file_name || e.file_id?.slice(0, 8) || '—')}</code><small class="cell-sub" dir="ltr">${esc(e.host || '')}</small></td><td>${date(e.occurred_at)}<small class="cell-sub">${new Date(e.occurred_at).toLocaleTimeString('fa-IR')}</small></td><td>${date(e.received_at)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(
        'هنوز رویدادی دریافت نشده',
        'داده‌ها فقط پس از ارسال واقعی از برنامه نمایش داده می‌شوند.',
        'radio',
      );
}
const localDateInput = (value?: string | null) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
export function licenseProfile(l: LicenseView, c: Context) {
  const events = (c.data.telemetry || []).filter((e) => e.license_id === l.id);
  const d = modal(
    l.display_name || 'پرونده لایسنس',
    `<div class="license-hero"><div>${badge(l.tier)}<h3>${esc(l.display_name || l.prefix + '••••')}</h3><code>${esc(l.id)}</code></div><span class="status ${l.status}">${esc({ active: 'فعال', unused: 'فعال‌نشده', suspended: 'معلق', revoked: 'لغوشده' }[l.status])}</span></div><div class="console-tabs" role="group" aria-label="بخش‌های پرونده لایسنس"><button type="button" class="current" aria-pressed="true" data-profile-tab="details">مشخصات و کنترل</button><button type="button" aria-pressed="false" data-profile-tab="activity">دانلود و نصب</button><button type="button" aria-pressed="false" data-profile-tab="history">تاریخچه مدیران</button></div><section data-profile-panel="details"><div class="profile-summary"><div><small>اعتبار تا</small><b>${date(l.expires_at)}</b></div><div><small>فعال‌سازی دستگاه</small><b>${fa(l.activation_count)}</b></div><div><small>اجراهای گزارش‌شده</small><b id="profile-open-count">…</b></div></div><form id="license-metadata">${field('نام دلخواه', `<input name="display_name" maxlength="120" value="${esc(l.display_name || '')}">`)}${field('برچسب‌ها (با ویرگول جدا کنید)', `<input name="tags" value="${esc((l.tags || []).join(', '))}">`)}${field('توضیحات داخلی', `<textarea name="notes" rows="4" maxlength="4000">${esc(l.notes || '')}</textarea>`)}${can(c, 'licenses.update') ? '<button class="button" type="submit">ذخیره مشخصات</button>' : ''}</form>${can(c, 'licenses.update') && c.data.capabilities?.includes('license-window-v1') ? `<form id="license-window" class="panel" data-guard-discard><h3>بازهٔ اعتبار تقویمی</h3><div class="form-grid">${field('شروع مجاز (زمان محلی؛ اختیاری)', `<input name="starts_at" type="datetime-local" value="${localDateInput(l.starts_at)}">`)}${field('انقضای ثابت (زمان محلی)', `<input name="expires_at" type="datetime-local" ${l.activated_at ? 'required' : ''} value="${localDateInput(l.expires_at)}">`)}</div><p class="fine-print">خالی‌بودن تاریخ شروع یعنی فعال‌سازی از همین حالا مجاز است. افزایش انقضا به مجوز مستقل تمدید نیاز دارد. ذخیره، اعتبار grant قبلی را برای درخواست آنلاین جدید باطل می‌کند.</p><button type="submit" class="button secondary">ذخیره بازه اعتبار</button></form>` : ''}<div class="license-controls">${can(c, 'licenses.extend') ? `<label class="field">روز تمدید<input id="extend-days" type="number" min="1" max="365" value="30"></label><button class="button secondary" data-license-action="extend">تمدید اعتبار</button>` : ''}${can(c, 'licenses.update') ? `<label class="field">سطح جدید<select id="new-tier">${['normal', 'pro', 'vip'].map((t) => `<option ${t === l.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></label><button class="button secondary" data-license-action="tier">تغییر سطح</button>` : ''}${(
      ['suspend', 'resume', 'reset', 'revoke', 'archive'] as const
    )
      .filter((a) => can(c, `licenses.${a === 'resume' ? 'suspend' : a}` as Permission))
      .map(
        (a) =>
          `<button class="button ${a === 'revoke' ? 'danger-button' : 'secondary'}" data-license-action="${a}">${{ suspend: 'تعلیق', resume: 'رفع تعلیق', reset: 'آزادسازی دستگاه', revoke: 'لغو دائمی', archive: l.archived ? 'خارج کردن از بایگانی' : 'بایگانی و تعلیق' }[a]}</button>`,
      )
      .join(
        '',
      )}</div><p class="fine-print">مجوز آفلاینِ قبلاً صادرشده فوراً از دستگاه حذف نمی‌شود. بایگانی، سابقه را نگه می‌دارد و صدور دسترسی جدید را متوقف می‌کند.</p></section><section data-profile-panel="activity" hidden><div id="profile-activity">${activityTable(events, c.data.packages)}</div><button class="button secondary" id="load-activity">دریافت تاریخچه بیشتر از سرور</button></section><section data-profile-panel="history" hidden><div id="profile-history" class="audit-timeline"></div><button type="button" class="button secondary" id="load-audit">تاریخچه قدیمی‌تر</button></section>`,
    true,
  );
  const windowForm = d.querySelector<HTMLFormElement>('#license-window');
  if (windowForm)
    windowForm.onsubmit = (e) => {
      e.preventDefault();
      void busy(windowForm.querySelector('[type=submit]')!, async () => {
        if (!window.confirm('بازهٔ اعتبار تغییر کند؟ دسترسی آنلاین با بازهٔ جدید کنترل خواهد شد.'))
          return;
        const f = new FormData(windowForm);
        await api(
          `/admin/licenses/${l.id}/window`,
          {
            starts_at: f.get('starts_at')
              ? new Date(String(f.get('starts_at'))).toISOString()
              : null,
            expires_at: f.get('expires_at')
              ? new Date(String(f.get('expires_at'))).toISOString()
              : null,
            expected_version: l.entitlement_version,
          },
          c.token,
        );
        d.close();
        await c.reload();
        toast('بازه اعتبار ثبت شد.');
      });
    };
  if (!can(c, 'licenses.update'))
    d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '#license-metadata input, #license-metadata textarea',
    ).forEach((input) => {
      input.readOnly = true;
    });
  d.querySelectorAll<HTMLButtonElement>('[data-profile-tab]').forEach(
    (button) =>
      (button.onclick = () => {
        d.querySelectorAll('[data-profile-tab]').forEach((b) => {
          b.classList.toggle('current', b === button);
          b.setAttribute('aria-pressed', String(b === button));
        });
        d.querySelectorAll<HTMLElement>('[data-profile-panel]').forEach(
          (p) => (p.hidden = p.dataset.profilePanel !== button.dataset.profileTab),
        );
      }),
  );
  const adminEvents = ((c.data as any).events || []).filter((e: any) => e.target === l.id);
  d.querySelector('#profile-history')!.innerHTML = adminEvents.length
    ? adminEvents
        .map(
          (e: any) =>
            `<article><b dir="ltr">${esc(e.action)}</b><p>${esc(e.actor)}</p><small>${date(e.created_at)}</small></article>`,
        )
        .join('')
    : '<p class="muted">رویدادی در تاریخچه دریافتی شما نیست یا مجوز مشاهده آن را ندارید.</p>';
  d.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    if (!can(c, 'licenses.update')) return;
    void busy(d.querySelector('button[type=submit]')!, async () => {
      const f = new FormData(e.target as HTMLFormElement);
      await api(
        `/admin/licenses/${l.id}/metadata`,
        {
          display_name: f.get('display_name'),
          notes: f.get('notes'),
          tags: String(f.get('tags'))
            .split(/[,،]/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
        c.token,
      );
      d.close();
      await c.reload();
      toast('پرونده به‌روزرسانی شد.');
    });
  };
  d.querySelectorAll<HTMLButtonElement>('[data-license-action]').forEach(
    (button) =>
      (button.onclick = () => {
        const action = button.dataset.licenseAction!;
        const confirm = modal(
          'تأیید عملیات',
          `<p>«${esc(button.textContent)}» برای این لایسنس ثبت شود؟</p><button class="button full" id="confirm-action">تأیید و ثبت</button>`,
        );
        confirm.querySelector<HTMLButtonElement>('#confirm-action')!.onclick = function () {
          void busy(this as HTMLButtonElement, async () => {
            const body =
              action === 'extend'
                ? { days: Number((d.querySelector('#extend-days') as HTMLInputElement).value) }
                : action === 'tier'
                  ? { tier: (d.querySelector('#new-tier') as HTMLSelectElement).value }
                  : action === 'archive'
                    ? { archived: !l.archived }
                    : {};
            await api(`/admin/licenses/${l.id}/${action}`, body, c.token);
            confirm.close();
            d.close();
            await c.reload();
            toast('تغییر ثبت شد.');
          });
        };
      }),
  );
  let cursor = '';
  let rows: TelemetryEvent[] = [];
  const loadActivity = async () => {
    const response = await api<{
      events: TelemetryEvent[];
      next: string | null;
      stats: {
        totals: { type: string; count: number }[];
        first_seen: string | null;
        last_seen: string | null;
      };
    }>(
      `/admin/licenses/${l.id}/activity${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      undefined,
      c.token,
    );
    rows.push(...response.events);
    cursor = response.next || '';
    d.querySelector('#profile-activity')!.innerHTML = activityTable(rows, c.data.packages);
    const count = d.querySelector('#profile-open-count');
    if (count)
      count.textContent = fa(
        Number(response.stats.totals.find((t) => t.type === 'app_open')?.count || 0),
      );
    const button = d.querySelector<HTMLButtonElement>('#load-activity')!;
    button.disabled = !response.next;
    button.textContent = response.next ? 'رویدادهای قدیمی‌تر' : 'پایان تاریخچه';
  };
  d.querySelector<HTMLButtonElement>('#load-activity')!.onclick = function () {
    void busy(this as HTMLButtonElement, loadActivity);
  };
  void loadActivity().catch(() => {});
  let auditCursor = '';
  let auditRows: any[] = [];
  const loadAudit = async () => {
    const response = await api<any>(
      `/admin/licenses/${l.id}/audit${auditCursor ? '?cursor=' + encodeURIComponent(auditCursor) : ''}`,
      undefined,
      c.token,
    );
    auditRows.push(...response.events);
    auditCursor = response.next || '';
    d.querySelector('#profile-history')!.innerHTML =
      auditRows
        .map(
          (e) =>
            `<article><b dir="ltr">${esc(e.action)}</b><p>${esc(e.actor)}</p><small>${date(e.created_at)}</small><details><summary>جزئیات تغییر</summary><pre class="audit-detail">${esc(e.detail)}</pre></details></article>`,
        )
        .join('') || '<p class="muted">رویدادی برای این لایسنس ثبت نشده است.</p>';
    d.querySelector<HTMLButtonElement>('#load-audit')!.disabled = !response.next;
  };
  if (can(c, 'audit.read')) {
    void loadAudit().catch(() => {});
    d.querySelector<HTMLButtonElement>('#load-audit')!.onclick = function () {
      void busy(this as HTMLButtonElement, loadAudit);
    };
  } else d.querySelector<HTMLButtonElement>('#load-audit')!.hidden = true;
  decorate();
}
export async function renderConsole(el: HTMLElement, page: string, c: Context): Promise<boolean> {
  const need: Record<string, Permission> = {
    analytics: 'analytics.read',
    errors: 'errors.read',
    team: 'team.manage',
    service: 'service.manage',
  };
  if (!need[page]) return false;
  if (!(page === 'team' ? can(c, 'team.manage') || can(c, 'roles.manage') : can(c, need[page]))) {
    el.innerHTML = empty(
      'دسترسی این بخش واگذار نشده',
      'مالک می‌تواند مجوزهای حساب مدیریتی شما را تغییر دهد.',
      'shield',
    );
    decorate();
    return true;
  }
  if (page === 'team') await team(el, c);
  else if (page === 'service') service(el, c);
  else if (page === 'errors') await errorCenter(el, c);
  else await analytics(el, c);
  decorate();
  return true;
}
function permissionEditor(
  admin: Admin,
  selected: Permission[],
  available = Permission.options as readonly Permission[],
) {
  const groups = [
    ['licenses.', 'لایسنس و دستگاه'],
    ['content.', 'پکیج و انتشار'],
    ['categories.', 'دسته‌بندی‌ها'],
    ['users.', 'پروفایل کاربران'],
    ['devices.', 'دستگاه‌ها'],

    ['analytics.', 'آمار'],
    ['errors.', 'خطاها'],
    ['audit.', 'گزارش امنیتی'],
    ['team.', 'مدیریت اعضا — حساس'],
    ['roles.', 'مدیریت نقش‌ها — حساس'],
    ['service.', 'تنظیمات سیستم — حساس'],
  ];
  return `<div class="permission-sections">${groups
    .map(([prefix, label]) => {
      const items = Permission.options.filter(
        (p) => available.includes(p) && p.startsWith(prefix) && hasPermission(admin, p),
      );
      if (!items.length) return '';
      return `<fieldset class="permission-section"><legend>${label}</legend><div class="permission-grid">${items.map((p) => `<label><input type="checkbox" name="permission" value="${p}" ${selected.includes(p) ? 'checked' : ''}><span>${permissionLabels[p]}<small dir="ltr">${p}</small></span></label>`).join('')}</div></fieldset>`;
    })
    .join('')}</div>`;
}
async function team(el: HTMLElement, c: Context) {
  const {
    members,
    license_options,
    roles: receivedRoles,
    available_permissions,
  } = await api<{
    members: AdminAccess[];
    roles?: CustomRole[];
    available_permissions?: Permission[];
    license_options: ConsoleData['licenses'];
  }>('/admin/team', undefined, c.token);
  const supportsRoles = Array.isArray(receivedRoles);
  const customRoles = receivedRoles || [];
  const available =
    available_permissions ||
    Permission.options.filter(
      (p) =>
        ![
          'content.create',
          'content.update',
          'roles.manage',
          'content.delete',
          'content.versions',
          'categories.manage',
          'users.read',
          'users.manage',
          'devices.read',
        ].includes(p),
    );
  el.innerHTML =
    heading(
      'PEOPLE & PERMISSIONS / 06',
      'تیم شما. مرزهای روشن.',
      'هر مدیر با لایسنس و کلید دستگاه مستقل؛ تغییر مجوزها در درخواست بعدی کنترل می‌شود.',
    ) +
    `<div class="console-notice">${icon('key-round')}ابتدا لایسنس بسازید، سپس اینجا دسترسی بدهید. فرد با همان کد، برنامه و دسترسی مدیریتی خود را فعال می‌کند.</div><div class="team-grid">${members
      .map((m) => {
        const l = license_options.find((l) => l.id === m.id);
        return `<article class="panel member-card"><span class="avatar">${esc((l?.display_name || l?.prefix || 'A').slice(0, 2))}</span><h3>${esc(l?.display_name || l?.prefix || m.id.slice(0, 8))}</h3><span class="console-pill">${esc(roles[m.role])}</span><p class="muted">${m.enabled ? 'دسترسی فعال' : 'دسترسی متوقف'} · ${fa(m.role === 'owner' ? Permission.options.length : accessPermissions(m, customRoles).length)} مجوز مشخص</p><small>${date(m.updated_at)}</small><button class="button secondary" data-edit-member="${m.id}">تنظیم دسترسی‌ها</button></article>`;
      })
      .join(
        '',
      )} ${can(c, 'team.manage') ? `<button class="panel add-member-card" id="new-member">${icon('plus')}<b>واگذاری دسترسی جدید</b><span>انتخاب لایسنس و مجوزها</span></button>` : ''}</div>${supportsRoles && can(c, 'roles.manage') ? `<section class="panel role-catalog"><div class="section-heading"><div><h2>نقش‌های سفارشی</h2><p class="muted">نقش‌ها قابل استفادهٔ مجددند؛ غیرفعال‌سازی نقش، مجوزهای آن را در درخواست بعدی حذف می‌کند.</p></div><button class="button secondary" id="new-role">ساخت نقش</button></div><div class="team-grid">${customRoles.map((r) => `<article class="role-card"><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><span class="console-pill">${r.enabled ? 'فعال' : 'غیرفعال'} · ${fa(r.permissions.length)} مجوز</span><button class="text-button" data-edit-role="${r.id}">ویرایش نقش</button></article>`).join('')}</div></section>` : ''}`;
  const edit = (existing?: AdminAccess) => {
    const candidates = (license_options || c.data.licenses).filter(
      (l) =>
        !l.archived && l.status !== 'revoked' && (existing || !members.some((m) => m.id === l.id)),
    );
    if (!candidates.length) {
      toast('ابتدا یک لایسنس قابل استفاده بسازید.', true);
      return;
    }
    const d = modal(
      'مجوزهای حساب مدیریتی',
      `<form id="access-form">${field('لایسنس', `<select name="license_id" ${existing ? 'disabled' : ''}>${candidates.map((l) => `<option value="${l.id}" ${existing?.id === l.id ? 'selected' : ''}>${esc(l.display_name || l.prefix)} · ${l.id.slice(0, 8)}</option>`).join('')}</select>`)}${field(
        'قالب نقش',
        `<select name="role">${Object.entries(roles)
          .filter(([r]) => c.data.admin.role === 'owner' || r !== 'owner')
          .map(
            ([r, label]) =>
              `<option value="${r}" ${(existing?.role || 'support') === r ? 'selected' : ''}>${label}</option>`,
          )
          .join('')}</select>`,
      )}<label class="setting-row"><span>دسترسی مدیریت فعال باشد</span><input type="checkbox" name="enabled" ${!existing || existing.enabled ? 'checked' : ''}></label><h3>نقش‌های سفارشی هم‌زمان</h3><div class="permission-grid">${
        customRoles
          .filter((r) => r.enabled && r.permissions.every((p) => hasPermission(c.data.admin, p)))
          .map(
            (r) =>
              `<label><input type="checkbox" name="role_ids" value="${r.id}" ${existing?.role_ids?.includes(r.id) ? 'checked' : ''}><span>${esc(r.name)}<small>${esc(r.description)}</small></span></label>`,
          )
          .join('') || '<p class="muted">هنوز نقش قابل واگذاری وجود ندارد.</p>'
      }</div><h3>مجوزهای مستقیم (مستقل از نقش‌ها)</h3>${permissionEditor(c.data.admin, existing?.permissions || rolePermissions.support, available)}<p class="fine-print">نقش مالک همه اختیارات برنامه را دارد. مجوزهای رمز عبور آرشیو و مدیریت تیم حساس‌اند؛ فقط در صورت نیاز واگذار شوند. تغییر حساب فعلی خودتان ممنوع است.</p><button class="button full" type="submit">ذخیره و اعمال دسترسی</button></form>`,
      true,
    );
    d.querySelector<HTMLSelectElement>('[name=role]')!.onchange = function () {
      const list =
        rolePermissions[(this as HTMLSelectElement).value as keyof typeof rolePermissions];
      d.querySelectorAll<HTMLInputElement>('[name=permission]').forEach(
        (i) => (i.checked = list.includes(i.value as Permission)),
      );
    };
    d.querySelector('form')!.onsubmit = (e) => {
      e.preventDefault();
      void busy(d.querySelector('[type=submit]')!, async () => {
        const f = new FormData(e.target as HTMLFormElement);
        if (!window.confirm('دسترسی مدیریتی با این مجوزهای مستقیم و نقش‌های انتخاب‌شده اعمال شود؟'))
          return;
        await api(
          `/admin/team/${existing?.id || f.get('license_id')}`,
          {
            role: f.get('role'),
            permissions: f.getAll('permission'),
            enabled: f.has('enabled'),
            ...(supportsRoles
              ? { role_ids: f.getAll('role_ids'), expected_version: existing?.version || 0 }
              : {}),
          },
          c.token,
        );
        d.close();
        await c.reload();
        toast('دسترسی جدید ثبت شد.');
      });
    };
    decorate();
  };
  const editRole = (existing?: CustomRole) => {
    const d = modal(
      existing ? 'ویرایش نقش سفارشی' : 'ساخت نقش سفارشی',
      `<form id="custom-role-form" data-guard-discard>${field('نام نقش', `<input name="name" required minlength="2" maxlength="80" value="${esc(existing?.name || '')}">`)}${field('توضیح کوتاه', `<textarea name="description" maxlength="300">${esc(existing?.description || '')}</textarea>`)}<label class="setting-row"><span>نقش فعال باشد</span><input type="checkbox" name="enabled" ${!existing || existing.enabled ? 'checked' : ''}></label>${permissionEditor(c.data.admin, existing?.permissions || [])}<p class="notice">تغییر این نقش بر تمام اعضای دارای آن اثر دارد؛ مجوزهای مستقیم و سایر نقش‌های آن‌ها باقی می‌مانند.</p><button class="button full" type="submit">ذخیره نقش</button></form>`,
      true,
    );
    d.querySelector('form')!.onsubmit = (e) => {
      e.preventDefault();
      void busy(d.querySelector('[type=submit]')!, async () => {
        if (!window.confirm('این تغییر برای همهٔ اعضای دارای این نقش اعمال شود؟')) return;
        const f = new FormData(e.target as HTMLFormElement);
        await api(
          `/admin/roles/${existing?.id || crypto.randomUUID()}`,
          {
            name: f.get('name'),
            description: f.get('description'),
            enabled: f.has('enabled'),
            permissions: f.getAll('permission'),
            expected_version: existing?.version || 0,
          },
          c.token,
        );
        d.close();
        await c.reload();
        toast('نقش با ثبت تاریخچه ذخیره شد.');
      });
    };
    decorate();
  };
  el.querySelector('#new-role')?.addEventListener('click', () => editRole());
  el.querySelectorAll<HTMLButtonElement>('[data-edit-role]').forEach(
    (b) => (b.onclick = () => editRole(customRoles.find((r) => r.id === b.dataset.editRole))),
  );
  el.querySelector('#new-member')?.addEventListener('click', () => edit());
  el.querySelectorAll<HTMLButtonElement>('[data-edit-member]').forEach(
    (b) => (b.onclick = () => edit(members.find((m) => m.id === b.dataset.editMember))),
  );
}
function service(el: HTMLElement, c: Context) {
  const s = c.data.service || defaultService();
  el.innerHTML =
    heading(
      'SERVICE OPERATIONS / 07',
      'کنترل سرویس، بدون قطع کور.',
      'عملیات جدید را متوقف کنید؛ پنل و دریافت گزارش‌ها برای مدیریت و عیب‌یابی در دسترس می‌مانند.',
    ) +
    `<form id="service-form" class="panel service-card">${(['maintenance', 'activation_paused', 'issuance_paused', 'downloads_paused'] as const).map((k) => `<label class="setting-row"><div><b>${{ maintenance: 'حالت نگهداری عمومی', activation_paused: 'توقف فعال‌سازی لایسنس جدید', issuance_paused: 'توقف صدور کد جدید', downloads_paused: 'توقف شروع دانلود و نصب جدید' }[k]}</b><p>تغییر سمت API اعمال و در تاریخچه ثبت می‌شود.</p></div><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}></label>`).join('')}${field('پیام برای کاربران', `<textarea name="message" maxlength="500" rows="3">${esc(s.message)}</textarea>`)}<button class="button" type="submit">اعمال وضعیت سرویس</button><p class="fine-print">این کنترل، نصب جاری را وسط تغییر فایل‌ها قطع نمی‌کند و لینک دریافت‌شده از هاست خارجی را باطل نمی‌کند.</p></form><section class="panel integration-card"><span class="console-pill">NOT CONNECTED</span><h3>کنترل ربات / سرور بازی</h3><p class="muted">ربات یا میزبان مشخصی به پروژه متصل نشده است. برای امنیت، دکمه توقف فرضی یا اجرای دستور دلخواه سرور وجود ندارد.</p></section>`;
  el.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void busy(el.querySelector('[type=submit]')!, async () => {
      await api(
        '/admin/service',
        {
          maintenance: f.has('maintenance'),
          activation_paused: f.has('activation_paused'),
          issuance_paused: f.has('issuance_paused'),
          downloads_paused: f.has('downloads_paused'),
          message: String(f.get('message')),
        },
        c.token,
      );
      await c.reload();
      toast('وضعیت سرویس اعمال شد.');
    });
  };
}
async function errorCenter(el: HTMLElement, c: Context) {
  let events: TelemetryEvent[] = [];
  let cursor = '';
  el.innerHTML =
    heading(
      'INCIDENT DESK / 08',
      'خطاها، قابل پیگیری.',
      'نتیجه واقعی گزارش‌های کلاینت؛ بدون ثبت رمز آرشیو، مسیر شخصی یا لینک امضاشده.',
    ) +
    `<div class="toolbar"><label class="search">${icon('search')}<input aria-label="جست‌وجوی خطاها" id="error-search" placeholder="کد خطا، لایسنس یا پکیج…"></label><select id="error-status" aria-label="فیلتر وضعیت خطا"><option value="open">نیازمند رسیدگی</option><option value="all">همه</option><option value="resolved">رسیدگی‌شده</option></select></div><div id="incident-list" class="incident-list"></div><button class="button secondary" id="load-errors">گزارش‌های قدیمی‌تر</button>`;
  const render = () => {
    const q = (el.querySelector('#error-search') as HTMLInputElement).value.toLowerCase();
    const status = (el.querySelector('#error-status') as HTMLSelectElement).value;
    const selected = events.filter(
      (e) =>
        (status === 'all' || (status === 'resolved' ? !!e.resolved_at : !e.resolved_at)) &&
        `${e.error_code} ${e.package_id} ${e.license_id}`.toLowerCase().includes(q),
    );
    el.querySelector('#incident-list')!.innerHTML = selected.length
      ? selected
          .map(
            (e) =>
              `<article class="panel incident-card"><span class="event-state is-error">${esc(e.error_code || eventLabels[e.type])}</span><h3>${esc(errors[e.error_code || ''] || eventLabels[e.type])}</h3><p>${esc(c.data.packages.find((p) => p.id === e.package_id)?.name || 'برنامه')} · ${esc(e.stage || '—')} · ${esc(e.host || '')}</p><div class="incident-meta"><code>${esc(e.license_id.slice(0, 8))}</code><span>${date(e.occurred_at)}</span><span>${e.resolved_at ? 'رسیدگی‌شده' : 'جدید'}</span></div>${!e.resolved_at && can(c, 'errors.resolve') ? `<button class="button secondary" data-resolve="${e.id}" data-license-id="${e.license_id}">ثبت رسیدگی</button>` : ''}</article>`,
          )
          .join('')
      : empty(
          'خطایی در این فیلتر نیست',
          'نبود گزارش به معنی اثبات نبود خطا در دستگاه‌های آفلاین نیست.',
          'circle-check',
        );
    el.querySelectorAll<HTMLButtonElement>('[data-resolve]').forEach(
      (b) =>
        (b.onclick = () =>
          void busy(b, async () => {
            await api(
              `/admin/errors/${b.dataset.resolve}/resolve`,
              { license_id: b.dataset.licenseId },
              c.token,
            );
            await c.reload();
          })),
    );
    decorate();
  };
  el.querySelector('#error-search')!.addEventListener('input', render);
  async function load(append: boolean) {
    const status = (el.querySelector('#error-status') as HTMLSelectElement).value;
    const response = await api<{ events: TelemetryEvent[]; next: string | null }>(
      `/admin/errors?status=${status}${append && cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
      undefined,
      c.token,
    );
    events = append ? events.concat(response.events) : response.events;
    cursor = response.next || '';
    el.querySelector<HTMLButtonElement>('#load-errors')!.disabled = !response.next;
    render();
  }
  el.querySelector('#error-status')!.addEventListener('change', () => void load(false));
  el.querySelector<HTMLButtonElement>('#load-errors')!.onclick = function () {
    void busy(this as HTMLButtonElement, () => load(true));
  };
  await load(false);
}
async function analytics(el: HTMLElement, c: Context) {
  el.innerHTML =
    heading(
      'INSIGHTS / 09',
      'عملکرد واقعی، نه حدس.',
      'دانلود موفق پس از تأیید هش؛ نصب موفق پس از commit موتور نصب. آمار آفلاین با تأخیر همگام می‌شود.',
    ) +
    `<div class="toolbar"><label>بازه زمانی <select id="analytics-days"><option value="7">۷ روز</option><option value="30" selected>۳۰ روز</option><option value="90">۹۰ روز</option></select></label><label>نمودار <select id="analytics-metric"><option value="downloads">دانلود کامل پکیج</option><option value="installs">نصب موفق</option><option value="errors">خطاها</option><option value="opens">اجرای برنامه</option></select></label></div><div id="analytics-content"></div>`;
  const draw = async () => {
    const days = Number((el.querySelector('#analytics-days') as HTMLSelectElement).value);
    const data = await api<any>(`/admin/analytics?days=${days}`, undefined, c.token);
    const count = (type: string) =>
      Number(data.totals.find((t: any) => t.type === type)?.count || 0);
    const metric = (el.querySelector('#analytics-metric') as HTMLSelectElement).value;
    const titles: Record<string, string> = {
      downloads: 'دانلود کامل پکیج',
      installs: 'نصب موفق',
      errors: 'خطاها',
      opens: 'اجرای برنامه',
    };
    const series = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - days + 1 + i);
      const day = date.toISOString().slice(0, 10);
      return {
        day,
        opens: 0,
        downloads: 0,
        installs: 0,
        errors: 0,
        ...data.daily.find((d: any) => d.day === day),
      };
    });
    const max = Math.max(1, ...series.map((d) => Number(d[metric])));
    el.querySelector('#analytics-content')!.innerHTML = `<div class="metrics">${[
      [count('app_open'), 'اجرای گزارش‌شده', 'monitor'],
      [count('package_download_completed'), 'دانلود تأییدشده', 'download'],
      [count('install_completed'), 'نصب موفق', 'circle-check'],
      [
        count('download_failed') + count('install_failed') + count('app_error'),
        'خطا',
        'triangle-alert',
      ],
    ]
      .map(
        ([n, label, i]) =>
          `<div class="metric">${icon(String(i))}<span>${label}</span><strong>${fa(Number(n))}</strong></div>`,
      )
      .join(
        '',
      )}</div><div class="insight-grid"><section class="panel chart-panel"><div class="section-heading"><h2>روند ${titles[metric]}</h2><span>روزانه</span></div><div class="bar-chart" tabindex="0" role="region" aria-label="نمودار روزانه ${titles[metric]}">${series.map((d) => `<div class="chart-column"><span>${fa(Number(d[metric]))}</span><i style="height:${Math.max(2, (Number(d[metric]) / max) * 150)}px" title="${esc(d.day)}: ${d[metric]}"></i><small>${new Date(d.day).toLocaleDateString('fa-IR', { day: 'numeric', month: 'numeric' })}</small></div>`).join('') || '<p class="muted">هنوز گزارشی برای این بازه دریافت نشده است.</p>'}</div></section><section class="panel"><div class="section-heading"><h2>نصب‌ها</h2><span>نتیجه گزارش‌شده</span></div><div class="success-ring" style="--success:${(count('install_completed') / Math.max(1, count('install_completed') + count('install_failed'))) * 100}%"><div><b>${fa(count('install_completed'))}</b><span>نصب موفق</span></div></div><p class="muted">${fa(count('install_failed'))} نصب ناموفق · ${fa(count('download_failed'))} دانلود ناموفق</p></section></div><section class="panel"><div class="section-heading"><h2>محبوب‌ترین پکیج‌ها</h2><span>دانلود / نصب / خطا</span></div>${data.packages.length ? `<div class="ranking-list">${data.packages.map((p: any, i: number) => `<article><span class="rank-number">${fa(i + 1)}</span><div><b>${esc(c.data.packages.find((q) => q.id === p.package_id)?.name || p.package_id)}</b><small>${fa(Number(p.installs))} نصب · ${fa(Number(p.errors))} خطا</small></div><strong>${fa(Number(p.downloads))}</strong></article>`).join('')}</div>` : empty('هنوز رتبه‌بندی وجود ندارد', 'با دریافت اولین رویداد واقعی، نمودار و رتبه‌بندی ساخته می‌شوند.', 'package')}</section><p class="fine-print">منبع: گزارش کلاینت‌های متصل به لایسنس. رویدادهای ارسال‌نشده یا اجرای پیش از فعال‌سازی در این آمار نیستند؛ این داده سند ضدتقلب یا شمارنده بازدید هاست خارجی نیست.</p>`;
    decorate();
  };
  el.querySelector('#analytics-days')!.addEventListener('change', () => void draw());
  el.querySelector('#analytics-metric')!.addEventListener('change', () => void draw());
  await draw();
}
