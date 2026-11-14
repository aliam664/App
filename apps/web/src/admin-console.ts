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
  type ContactSettings,
} from '../../../packages/contracts/src/index';
import {
  L,
  getLang,
  num,
  fmtDate,
  fmtTime,
  roleLabels,
  permissionLabelsMap,
  eventLabelsMap,
  telemetryErrorLabels,
} from './i18n';
import { renderContactAdmin } from './contact';
import { esc, icon, badge, modal, field, busy, toast, decorate, empty } from './ui';

type LicenseView = Omit<License, 'code_hash'>;
export type ConsoleData = {
  admin: Admin;
  capabilities?: string[];
  licenses: LicenseView[];
  telemetry?: TelemetryEvent[];
  service?: ServiceSettings | null;
  packages: { id: string; name: string }[];
};
type Context = {
  data: ConsoleData;
  token: string;
  reload: () => Promise<void>;
  onContactUpdated?: (contact: ContactSettings, configured: boolean) => void;
};

const can = (c: Context, p: Permission) => hasPermission(c.data.admin, p);

const heading = (over: string, title: string, description: string) =>
  `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>${over}</p><h1>${title}</h1><p class="muted">${description}</p></div><span class="console-pill">${icon('shield-check')} ${L('اتاق کنترل', 'CONTROL ROOM')}</span></div>`;

function activityTable(events: TelemetryEvent[], packages: Context['data']['packages']) {
  const evtLabels = eventLabelsMap();
  const errLabels = telemetryErrorLabels();
  return events.length
    ? `<div class="table-scroll"><table><thead><tr><th>${L('فعالیت / نتیجه', 'Activity / Outcome')}</th><th>${L('پکیج / نسخه', 'Package / Version')}</th><th>${L('فایل / میزبان', 'File / Host')}</th><th>${L('زمان وقوع', 'Occurred')}</th><th>${L('دریافت سرور', 'Received')}</th></tr></thead><tbody>${events.map((e) => `<tr><td><span class="event-state ${e.type.includes('failed') || e.type === 'app_error' ? 'is-error' : ''}">${esc(evtLabels[e.type] || e.type)}</span><small class="cell-sub">${esc(errLabels[e.error_code || ''] || e.error_code || '')}</small></td><td>${esc(packages.find((p) => p.id === e.package_id)?.name || '—')}<small class="cell-sub" dir="ltr">${esc(e.version || '')}</small></td><td><code dir="ltr">${esc(e.file_name || e.file_id?.slice(0, 8) || '—')}</code><small class="cell-sub" dir="ltr">${esc(e.host || '')}</small></td><td>${fmtDate(e.occurred_at)}<small class="cell-sub">${fmtTime(e.occurred_at)}</small></td><td>${fmtDate(e.received_at)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(
        L('هنوز رویدادی دریافت نشده', 'No telemetry events yet'),
        L(
          'داده‌ها فقط پس از ارسال واقعی از برنامه نمایش داده می‌شوند.',
          'Events appear only once reported by active launcher clients.',
        ),
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
  const statusMap =
    getLang() === 'en'
      ? { active: 'Active', unused: 'Unused', suspended: 'Suspended', revoked: 'Revoked' }
      : { active: 'فعال', unused: 'فعال‌نشده', suspended: 'معلق', revoked: 'لغوشده' };

  const d = modal(
    l.display_name || L('پرونده لایسنس', 'License Dossier'),
    `<div class="license-hero"><div>${badge(l.tier)}<h3>${esc(l.display_name || l.prefix + '••••')}</h3><code dir="ltr">${esc(l.id)}</code></div><span class="status ${l.status}">${esc(statusMap[l.status])}</span></div><div class="console-tabs" role="group" aria-label="${L('بخش‌های پرونده لایسنس', 'Dossier sections')}"><button type="button" class="current" aria-pressed="true" data-profile-tab="details">${L('مشخصات و کنترل', 'Details & Controls')}</button><button type="button" aria-pressed="false" data-profile-tab="activity">${L('دانلود و نصب', 'Client Activity')}</button><button type="button" aria-pressed="false" data-profile-tab="history">${L('تاریخچه مدیران', 'Audit History')}</button></div><section data-profile-panel="details"><div class="profile-summary"><div><small>${L('اعتبار تا', 'Expires')}</small><b>${fmtDate(l.expires_at)}</b></div><div><small>${L('فعال‌سازی دستگاه', 'Device Activations')}</small><b>${num(l.activation_count)}</b></div><div><small>${L('اجراهای گزارش‌شده', 'Reported Opens')}</small><b id="profile-open-count">…</b></div></div><form id="license-metadata">${field(L('نام دلخواه', 'Display Name'), `<input name="display_name" maxlength="120" value="${esc(l.display_name || '')}">`)}${field(L('برچسب‌ها (با ویرگول جدا کنید)', 'Tags (comma-separated)'), `<input name="tags" value="${esc((l.tags || []).join(', '))}">`)}${field(L('توضیحات داخلی', 'Internal Notes'), `<textarea name="notes" rows="4" maxlength="4000">${esc(l.notes || '')}</textarea>`)}${can(c, 'licenses.update') ? `<button class="button" type="submit">${L('ذخیره مشخصات', 'Save Details')}</button>` : ''}</form>${can(c, 'licenses.update') && c.data.capabilities?.includes('license-window-v1') ? `<form id="license-window" class="panel" data-guard-discard><h3>${L('بازهٔ اعتبار تقویمی', 'Calendar Validity Window')}</h3><div class="form-grid">${field(L('شروع مجاز (زمان محلی؛ اختیاری)', 'Allowed Start (local; optional)'), `<input name="starts_at" type="datetime-local" value="${localDateInput(l.starts_at)}">`)}${field(L('انقضای ثابت (زمان محلی)', 'Fixed Expiration (local)'), `<input name="expires_at" type="datetime-local" ${l.activated_at ? 'required' : ''} value="${localDateInput(l.expires_at)}">`)}</div><p class="fine-print">${L('خالی‌بودن تاریخ شروع یعنی فعال‌سازی از همین حالا مجاز است. افزایش انقضا به مجوز مستقل تمدید نیاز دارد. ذخیره، اعتبار grant قبلی را برای درخواست آنلاین جدید باطل می‌کند.', 'Leaving start blank allows activation immediately. Extending expiration requires licenses.extend. Saving invalidates prior online grants.')}</p><button type="submit" class="button secondary">${L('ذخیره بازه اعتبار', 'Save Window')}</button></form>` : ''}<div class="license-controls">${can(c, 'licenses.extend') ? `<label class="field"><span>${L('روز تمدید', 'Extend Days')}</span><input id="extend-days" type="number" min="1" max="365" value="30"></label><button class="button secondary" data-license-action="extend">${L('تمدید اعتبار', 'Extend')}</button>` : ''}${can(c, 'licenses.update') ? `<label class="field"><span>${L('سطح جدید', 'New Tier')}</span><select id="new-tier">${['normal', 'pro', 'vip'].map((t) => `<option ${t === l.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></label><button class="button secondary" data-license-action="tier">${L('تغییر سطح', 'Change Tier')}</button>` : ''}${(
      ['suspend', 'resume', 'reset', 'revoke', 'archive'] as const
    )
      .filter((a) => can(c, `licenses.${a === 'resume' ? 'suspend' : a}` as Permission))
      .map(
        (a) =>
          `<button class="button ${a === 'revoke' ? 'danger-button' : 'secondary'}" data-license-action="${a}">${{ suspend: L('تعلیق', 'Suspend'), resume: L('رفع تعلیق', 'Resume'), reset: L('آزادسازی دستگاه', 'Reset Device'), revoke: L('لغو دائمی', 'Revoke'), archive: l.archived ? L('خارج کردن از بایگانی', 'Unarchive') : L('بایگانی و تعلیق', 'Archive & Suspend') }[a]}</button>`,
      )
      .join(
        '',
      )}</div><p class="fine-print">${L('مجوز آفلاینِ قبلاً صادرشده فوراً از دستگاه حذف نمی‌شود. بایگانی، سابقه را نگه می‌دارد و صدور دسترسی جدید را متوقف می‌کند.', 'Existing signed offline grants cannot be remotely wiped until refresh/online checks. Archiving preserves history and blocks new access.')}</p></section><section data-profile-panel="activity" hidden><div id="profile-activity">${activityTable(events, c.data.packages)}</div><button class="button secondary" id="load-activity">${L('دریافت تاریخچه بیشتر از سرور', 'Load More Activity')}</button></section><section data-profile-panel="history" hidden><div id="profile-history" class="audit-timeline"></div><button type="button" class="button secondary" id="load-audit">${L('تاریخچه قدیمی‌تر', 'Older Audit Events')}</button></section>`,
    true,
  );
  const windowForm = d.querySelector<HTMLFormElement>('#license-window');
  if (windowForm)
    windowForm.onsubmit = (e) => {
      e.preventDefault();
      void busy(windowForm.querySelector('[type=submit]')!, async () => {
        if (
          !window.confirm(
            L(
              'بازهٔ اعتبار تغییر کند؟ دسترسی آنلاین با بازهٔ جدید کنترل خواهد شد.',
              'Apply new calendar window? Online checks will enforce the updated window.',
            ),
          )
        )
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
        toast(L('بازه اعتبار ثبت شد.', 'Validity window saved.'));
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
            `<article><b dir="ltr">${esc(e.action)}</b><p>${esc(e.actor)}</p><small>${fmtDate(e.created_at)}</small></article>`,
        )
        .join('')
    : `<p class="muted">${L('رویدادی در تاریخچه دریافتی شما نیست یا مجوز مشاهده آن را ندارید.', 'No audit events cached or visible for your role.')}</p>`;
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
      toast(L('پرونده به‌روزرسانی شد.', 'Dossier updated.'));
    });
  };
  d.querySelectorAll<HTMLButtonElement>('[data-license-action]').forEach(
    (button) =>
      (button.onclick = () => {
        const action = button.dataset.licenseAction!;
        const confirm = modal(
          L('تأیید عملیات', 'Confirm Action'),
          `<p>${L(`«${esc(button.textContent)}» برای این لایسنس ثبت شود؟`, `Apply "${esc(button.textContent)}" to this license?`)}</p><button class="button full" id="confirm-action">${L('تأیید و ثبت', 'Confirm & Apply')}</button>`,
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
            toast(L('تغییر ثبت شد.', 'Change committed.'));
          });
        };
      }),
  );
  let cursor = '';
  const rows: TelemetryEvent[] = [];
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
      count.textContent = num(
        Number(response.stats.totals.find((t) => t.type === 'app_open')?.count || 0),
      );
    const button = d.querySelector<HTMLButtonElement>('#load-activity')!;
    button.disabled = !response.next;
    button.textContent = response.next
      ? L('رویدادهای قدیمی‌تر', 'Load Older Activity')
      : L('پایان تاریخچه', 'End of Activity');
  };
  d.querySelector<HTMLButtonElement>('#load-activity')!.onclick = function () {
    void busy(this as HTMLButtonElement, loadActivity);
  };
  void loadActivity().catch(() => {});
  let auditCursor = '';
  const auditRows: any[] = [];
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
            `<article><b dir="ltr">${esc(e.action)}</b><p>${esc(e.actor)}</p><small>${fmtDate(e.created_at)}</small><details><summary>${L('جزئیات تغییر', 'Diff details')}</summary><pre class="audit-detail">${esc(e.detail)}</pre></details></article>`,
        )
        .join('') ||
      `<p class="muted">${L('رویدادی برای این لایسنس ثبت نشده است.', 'No audit entries for this license.')}</p>`;
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
    contact: 'contact.manage',
  };
  if (!need[page]) return false;
  if (!(page === 'team' ? can(c, 'team.manage') || can(c, 'roles.manage') : can(c, need[page]))) {
    el.innerHTML = empty(
      L('دسترسی این بخش واگذار نشده', 'Section Access Not Assigned'),
      L(
        'مالک می‌تواند مجوزهای حساب مدیریتی شما را تغییر دهد.',
        'The platform owner can grant this permission in Team & Access.',
      ),
      'shield',
    );
    decorate();
    return true;
  }
  if (page === 'team') await team(el, c);
  else if (page === 'service') service(el, c);
  else if (page === 'contact')
    await renderContactAdmin(el, c.token, c.reload, c.onContactUpdated || (() => {}));
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
  const pLabels = permissionLabelsMap();
  const groups = [
    ['licenses.', L('لایسنس و دستگاه', 'Licenses & Devices')],
    ['content.', L('پکیج و انتشار', 'Packages & Publishing')],
    ['categories.', L('دسته‌بندی‌ها', 'Categories')],
    ['users.', L('پروفایل کاربران', 'User Profiles')],
    ['devices.', L('دستگاه‌ها', 'Device Registry')],
    ['analytics.', L('آمار', 'Telemetry Analytics')],
    ['errors.', L('خطاها', 'Incident Desk')],
    ['audit.', L('گزارش امنیتی', 'Audit Logs')],
    ['contact.', L('تماس با ما', 'Contact Us')],
    ['team.', L('مدیریت اعضا — حساس', 'Team Management — Sensitive')],
    ['roles.', L('مدیریت نقش‌ها — حساس', 'Role Management — Sensitive')],
    ['service.', L('تنظیمات سیستم — حساس', 'Service Operations — Sensitive')],
  ];
  return `<div class="permission-sections">${groups
    .map(([prefix, label]) => {
      const items = Permission.options.filter(
        (p) => available.includes(p) && p.startsWith(prefix) && hasPermission(admin, p),
      );
      if (!items.length) return '';
      return `<fieldset class="permission-section"><legend>${label}</legend><div class="permission-grid">${items.map((p) => `<label><input type="checkbox" name="permission" value="${p}" ${selected.includes(p) ? 'checked' : ''}><span>${pLabels[p]}<small dir="ltr">${p}</small></span></label>`).join('')}</div></fieldset>`;
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
  const available = available_permissions || Permission.options;
  const rLabels = roleLabels();

  el.innerHTML =
    heading(
      'PEOPLE & PERMISSIONS / 06',
      L('تیم شما. مرزهای روشن.', 'Your Team. Clear Boundaries.'),
      L(
        'هر مدیر با لایسنس و کلید دستگاه مستقل؛ تغییر مجوزها در درخواست بعدی کنترل می‌شود.',
        'Each operator binds to an independent license and hardware key; changes apply immediately on the next request.',
      ),
    ) +
    `<div class="console-notice">${icon('key-round')}${L('ابتدا لایسنس بسازید، سپس اینجا دسترسی بدهید. فرد با همان کد، برنامه و دسترسی مدیریتی خود را فعال می‌کند.', 'Issue a license first, then assign its role and permissions here.')}</div><div class="team-grid">${members
      .map((m) => {
        const l = license_options.find((l) => l.id === m.id);
        return `<article class="panel member-card"><span class="avatar">${esc((l?.display_name || l?.prefix || 'A').slice(0, 2))}</span><h3>${esc(l?.display_name || l?.prefix || m.id.slice(0, 8))}</h3><span class="console-pill">${esc(rLabels[m.role])}</span><p class="muted">${m.enabled ? L('دسترسی فعال', 'Active access') : L('دسترسی متوقف', 'Disabled')} · ${num(m.role === 'owner' ? Permission.options.length : accessPermissions(m, customRoles).length)} ${L('مجوز مشخص', 'permissions')}</p><small>${fmtDate(m.updated_at)}</small><button class="button secondary" data-edit-member="${m.id}">${L('تنظیم دسترسی‌ها', 'Configure Access')}</button></article>`;
      })
      .join(
        '',
      )} ${can(c, 'team.manage') ? `<button class="panel add-member-card" id="new-member">${icon('plus')}<b>${L('واگذاری دسترسی جدید', 'Grant Team Access')}</b><span>${L('انتخاب لایسنس و مجوزها', 'Select license & permissions')}</span></button>` : ''}</div>${supportsRoles && can(c, 'roles.manage') ? `<section class="panel role-catalog"><div class="section-heading"><div><h2>${L('نقش‌های سفارشی', 'Custom Reusable Roles')}</h2><p class="muted">${L('نقش‌ها قابل استفادهٔ مجددند؛ غیرفعال‌سازی نقش، مجوزهای آن را در درخواست بعدی حذف می‌کند.', 'Disabling a reusable role revokes its inherited permissions on the next API request.')}</p></div><button class="button secondary" id="new-role">${L('ساخت نقش', 'Create Role')}</button></div><div class="team-grid">${customRoles.map((r) => `<article class="role-card"><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><span class="console-pill">${r.enabled ? L('فعال', 'Enabled') : L('غیرفعال', 'Disabled')} · ${num(r.permissions.length)} ${L('مجوز', 'perms')}</span><button class="text-button" data-edit-role="${r.id}">${L('ویرایش نقش', 'Edit Role')}</button></article>`).join('')}</div></section>` : ''}`;

  const edit = (existing?: AdminAccess) => {
    const candidates = (license_options || c.data.licenses).filter(
      (l) =>
        !l.archived && l.status !== 'revoked' && (existing || !members.some((m) => m.id === l.id)),
    );
    if (!candidates.length) {
      toast(
        L(
          'ابتدا یک لایسنس قابل استفاده بسازید.',
          'Generate an eligible active/unused license first.',
        ),
        true,
      );
      return;
    }
    const d = modal(
      L('مجوزهای حساب مدیریتی', 'Administrator Access Permissions'),
      `<form id="access-form">${field(L('لایسنس', 'License'), `<select name="license_id" ${existing ? 'disabled' : ''}>${candidates.map((l) => `<option value="${l.id}" ${existing?.id === l.id ? 'selected' : ''}>${esc(l.display_name || l.prefix)} · ${l.id.slice(0, 8)}</option>`).join('')}</select>`)}${field(
        L('قالب نقش', 'Base Role Preset'),
        `<select name="role">${Object.entries(rLabels)
          .filter(([r]) => c.data.admin.role === 'owner' || r !== 'owner')
          .map(
            ([r, label]) =>
              `<option value="${r}" ${(existing?.role || 'support') === r ? 'selected' : ''}>${label}</option>`,
          )
          .join('')}</select>`,
      )}<label class="setting-row"><span>${L('دسترسی مدیریت فعال باشد', 'Admin access enabled')}</span><input type="checkbox" name="enabled" ${!existing || existing.enabled ? 'checked' : ''}></label><h3>${L('نقش‌های سفارشی هم‌زمان', 'Attached Custom Roles')}</h3><div class="permission-grid">${
        customRoles
          .filter((r) => r.enabled && r.permissions.every((p) => hasPermission(c.data.admin, p)))
          .map(
            (r) =>
              `<label><input type="checkbox" name="role_ids" value="${r.id}" ${existing?.role_ids?.includes(r.id) ? 'checked' : ''}><span>${esc(r.name)}<small>${esc(r.description)}</small></span></label>`,
          )
          .join('') ||
        `<p class="muted">${L('هنوز نقش قابل واگذاری وجود ندارد.', 'No assignable custom roles available.')}</p>`
      }</div><h3>${L('مجوزهای مستقیم (مستقل از نقش‌ها)', 'Direct Permissions')}</h3>${permissionEditor(c.data.admin, existing?.permissions || rolePermissions.support, available)}<p class="fine-print">${L('نقش مالک همه اختیارات برنامه را دارد. مجوزهای رمز عبور آرشیو و مدیریت تیم حساس‌اند؛ فقط در صورت نیاز واگذار شوند. تغییر حساب فعلی خودتان ممنوع است.', 'Owner holds every permission. Sensitive access should follow least privilege; self-modification is blocked.')}</p><button class="button full" type="submit">${L('ذخیره و اعمال دسترسی', 'Save & Apply Access')}</button></form>`,
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
        if (
          !window.confirm(
            L(
              'دسترسی مدیریتی با این مجوزهای مستقیم و نقش‌های انتخاب‌شده اعمال شود؟',
              'Apply administrator role and selected direct/custom permissions?',
            ),
          )
        )
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
        toast(L('دسترسی جدید ثبت شد.', 'Team access updated.'));
      });
    };
    decorate();
  };

  const editRole = (existing?: CustomRole) => {
    const d = modal(
      existing
        ? L('ویرایش نقش سفارشی', 'Edit Custom Role')
        : L('ساخت نقش سفارشی', 'Create Custom Role'),
      `<form id="custom-role-form" data-guard-discard>${field(L('نام نقش', 'Role Name'), `<input name="name" required minlength="2" maxlength="80" value="${esc(existing?.name || '')}">`)}${field(L('توضیح کوتاه', 'Short Description'), `<textarea name="description" maxlength="300">${esc(existing?.description || '')}</textarea>`)}<label class="setting-row"><span>${L('نقش فعال باشد', 'Role enabled')}</span><input type="checkbox" name="enabled" ${!existing || existing.enabled ? 'checked' : ''}></label>${permissionEditor(c.data.admin, existing?.permissions || [])}<p class="notice">${L('تغییر این نقش بر تمام اعضای دارای آن اثر دارد؛ مجوزهای مستقیم و سایر نقش‌های آن‌ها باقی می‌مانند.', 'Updating this role affects all members linked to it while keeping their direct permissions intact.')}</p><button class="button full" type="submit">${L('ذخیره نقش', 'Save Role')}</button></form>`,
      true,
    );
    d.querySelector('form')!.onsubmit = (e) => {
      e.preventDefault();
      void busy(d.querySelector('[type=submit]')!, async () => {
        if (
          !window.confirm(
            L(
              'این تغییر برای همهٔ اعضای دارای این نقش اعمال شود؟',
              'Apply this role update to all attached members?',
            ),
          )
        )
          return;
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
        toast(L('نقش با ثبت تاریخچه ذخیره شد.', 'Role saved with audit record.'));
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
      L('کنترل سرویس، بدون قطع کور.', 'Service Operations Without Blind Outages.'),
      L(
        'عملیات جدید را متوقف کنید؛ پنل و دریافت گزارش‌ها برای مدیریت و عیب‌یابی در دسترس می‌مانند.',
        'Pause specific client actions gracefully while keeping diagnostics, audit logs, and admin control online.',
      ),
    ) +
    `<form id="service-form" class="panel service-card">${(['maintenance', 'activation_paused', 'issuance_paused', 'downloads_paused'] as const).map((k) => `<label class="setting-row"><div><b>${{ maintenance: L('حالت نگهداری عمومی', 'Global Maintenance Mode'), activation_paused: L('توقف فعال‌سازی لایسنس جدید', 'Pause New License Activations'), issuance_paused: L('توقف صدور کد جدید', 'Pause New License Issuance'), downloads_paused: L('توقف شروع دانلود و نصب جدید', 'Pause New Download Plans') }[k]}</b><p>${L('تغییر سمت API اعمال و در تاریخچه ثبت می‌شود.', 'Enforced server-side and logged in audit history.')}</p></div><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}></label>`).join('')}${field(L('پیام برای کاربران', 'Public Service Banner Message'), `<textarea name="message" maxlength="500" rows="3">${esc(s.message)}</textarea>`)}<button class="button" type="submit">${L('اعمال وضعیت سرویس', 'Apply Service State')}</button><p class="fine-print">${L('این کنترل، نصب جاری را وسط تغییر فایل‌ها قطع نمی‌کند و لینک دریافت‌شده از هاست خارجی را باطل نمی‌کند.', 'Does not abort active local installs mid-transaction or expire external CDN URLs.')}</p></form><section class="panel integration-card"><span class="console-pill">NOT CONNECTED</span><h3>${L('کنترل ربات / سرور بازی', 'External Bot / Game Server Control')}</h3><p class="muted">${L('ربات یا میزبان مشخصی به پروژه متصل نشده است. برای امنیت، دکمه توقف فرضی یا اجرای دستور دلخواه سرور وجود ندارد.', 'No remote game server or Discord bot bridge is attached. Arbitrary shell execution is intentionally disabled.')}</p></section>`;
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
      toast(L('وضعیت سرویس اعمال شد.', 'Service settings applied.'));
    });
  };
}

async function errorCenter(el: HTMLElement, c: Context) {
  let events: TelemetryEvent[] = [];
  let cursor = '';
  const evtLabels = eventLabelsMap();
  const errLabels = telemetryErrorLabels();

  el.innerHTML =
    heading(
      'INCIDENT DESK / 08',
      L('خطاها، قابل پیگیری.', 'Traceable Client Incidents.'),
      L(
        'نتیجه واقعی گزارش‌های کلاینت؛ بدون ثبت رمز آرشیو، مسیر شخصی یا لینک امضاشده.',
        'Real client telemetry incidents; archive passwords, user paths, and signed links are stripped.',
      ),
    ) +
    `<div class="toolbar"><label class="search">${icon('search')}<input aria-label="${L('جست‌وجوی خطاها', 'Search incidents')}" id="error-search" placeholder="${L('کد خطا، لایسنس یا پکیج…', 'Error code, license ID, or package…')}"></label><select id="error-status" aria-label="${L('فیلتر وضعیت خطا', 'Filter incident status')}"><option value="open">${L('نیازمند رسیدگی', 'Open')}</option><option value="all">${L('همه', 'All')}</option><option value="resolved">${L('رسیدگی‌شده', 'Resolved')}</option></select></div><div id="incident-list" class="incident-list"></div><button class="button secondary" id="load-errors">${L('گزارش‌های قدیمی‌تر', 'Load Older Incidents')}</button>`;
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
              `<article class="panel incident-card"><span class="event-state is-error">${esc(e.error_code || evtLabels[e.type])}</span><h3>${esc(errLabels[e.error_code || ''] || evtLabels[e.type])}</h3><p>${esc(c.data.packages.find((p) => p.id === e.package_id)?.name || L('برنامه', 'Launcher'))} · ${esc(e.stage || '—')} · ${esc(e.host || '')}</p><div class="incident-meta"><code dir="ltr">${esc(e.license_id.slice(0, 8))}</code><span>${fmtDate(e.occurred_at)}</span><span>${e.resolved_at ? L('رسیدگی‌شده', 'Resolved') : L('جدید', 'Open')}</span></div>${!e.resolved_at && can(c, 'errors.resolve') ? `<button class="button secondary" data-resolve="${e.id}" data-license-id="${e.license_id}">${L('ثبت رسیدگی', 'Mark Resolved')}</button>` : ''}</article>`,
          )
          .join('')
      : empty(
          L('خطایی در این فیلتر نیست', 'No matching incidents'),
          L(
            'نبود گزارش به معنی اثبات نبود خطا در دستگاه‌های آفلاین نیست.',
            'Absence of server events does not rule out offline client failures.',
          ),
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
      L('عملکرد واقعی، نه حدس.', 'Measured Performance, Zero Guesswork.'),
      L(
        'دانلود موفق پس از تأیید هش؛ نصب موفق پس از commit موتور نصب. آمار آفلاین با تأخیر همگام می‌شود.',
        'Downloads count post-checksum verification; installs count after atomic commit. Offline telemetry syncs on reconnect.',
      ),
    ) +
    `<div class="toolbar"><label>${L('بازه زمانی', 'Time Window')} <select id="analytics-days"><option value="7">${L('۷ روز', '7 Days')}</option><option value="30" selected>${L('۳۰ روز', '30 Days')}</option><option value="90">${L('۹۰ روز', '90 Days')}</option></select></label><label>${L('نمودار', 'Metric')} <select id="analytics-metric"><option value="downloads">${L('دانلود کامل پکیج', 'Completed Downloads')}</option><option value="installs">${L('نصب موفق', 'Verified Installs')}</option><option value="errors">${L('خطاها', 'Incidents')}</option><option value="opens">${L('اجرای برنامه', 'Launcher Opens')}</option></select></label></div><div id="analytics-content"></div>`;

  const draw = async () => {
    const days = Number((el.querySelector('#analytics-days') as HTMLSelectElement).value);
    const data = await api<any>(`/admin/analytics?days=${days}`, undefined, c.token);
    const count = (type: string) =>
      Number(data.totals.find((t: any) => t.type === type)?.count || 0);
    const metric = (el.querySelector('#analytics-metric') as HTMLSelectElement).value;
    const titles: Record<string, string> = {
      downloads: L('دانلود کامل پکیج', 'Completed Package Downloads'),
      installs: L('نصب موفق', 'Verified Installs'),
      errors: L('خطاها', 'Errors & Failures'),
      opens: L('اجرای برنامه', 'Launcher Opens'),
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

    // CSP-compliant SVG bar chart (zero inline style="" attributes!)
    const svgW = Math.max(460, series.length * 22);
    const barW = Math.max(6, Math.floor((svgW - 24) / series.length) - 4);
    const stepX = (svgW - 24) / series.length;
    const labelEvery = series.length > 45 ? 10 : series.length > 14 ? 5 : 1;
    const barsSvg = `<svg class="chart-svg" viewBox="0 0 ${svgW} 195" role="img" aria-label="${esc(titles[metric])}">${series
      .map((d, idx) => {
        const val = Number(d[metric]);
        const h = val > 0 ? Math.max(4, Math.round((val / max) * 140)) : 0;
        const x = Math.round(12 + idx * stepX);
        const y = 160 - h;
        const showLabel = idx % labelEvery === 0 || idx === series.length - 1;
        const shortDay = d.day.slice(5);
        return `<g><rect class="chart-bar-track" x="${x}" y="20" width="${barW}" height="140" rx="2"/>${h > 0 ? `<rect class="chart-bar-rect" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2"><title>${esc(d.day)}: ${val}</title></rect>` : `<title>${esc(d.day)}: 0</title>`}${showLabel ? `<text class="chart-label-text" x="${x}" y="182">${esc(shortDay)}</text>` : ''}</g>`;
      })
      .join('')}</svg>`;

    const completed = count('install_completed');
    const failedInstalls = count('install_failed');
    const rate = completed / Math.max(1, completed + failedInstalls);
    const circumference = 2 * Math.PI * 44;
    const dash = Math.round(rate * circumference * 10) / 10;

    el.querySelector('#analytics-content')!.innerHTML = `<div class="metrics">${[
      [count('app_open'), L('اجرای گزارش‌شده', 'Reported Opens'), 'monitor'],
      [count('package_download_completed'), L('دانلود تأییدشده', 'Verified Downloads'), 'download'],
      [completed, L('نصب موفق', 'Verified Installs'), 'circle-check'],
      [
        count('download_failed') + failedInstalls + count('app_error'),
        L('خطا', 'Reported Errors'),
        'triangle-alert',
      ],
    ]
      .map(
        ([n, label, i]) =>
          `<div class="metric">${icon(String(i))}<span>${label}</span><strong>${num(Number(n))}</strong></div>`,
      )
      .join(
        '',
      )}</div><div class="insight-grid"><section class="panel chart-panel"><div class="section-heading"><h2>${L('روند', 'Trend:')} ${titles[metric]}</h2><span>${L('روزانه', 'Daily')}</span></div><div class="bar-chart" tabindex="0" role="region" aria-label="${L('نمودار روزانه', 'Daily chart for')} ${esc(titles[metric])}">${barsSvg}</div></section><section class="panel"><div class="section-heading"><h2>${L('نصب‌ها', 'Install Success')}</h2><span>${L('نتیجه گزارش‌شده', 'Reported Outcomes')}</span></div><div class="ring-wrap"><svg class="ring-svg" viewBox="0 0 112 112" aria-hidden="true"><circle class="ring-track" cx="56" cy="56" r="44"/><circle class="ring-fill" cx="56" cy="56" r="44" stroke-dasharray="${dash} ${circumference.toFixed(1)}"/><text class="ring-center-text" x="56" y="56">${Math.round(rate * 100)}%</text></svg><div><b>${num(completed)}</b> ${L('نصب موفق', 'successful installs')}<p class="muted">${num(failedInstalls)} ${L('نصب ناموفق', 'failed installs')} · ${num(count('download_failed'))} ${L('دانلود ناموفق', 'failed downloads')}</p></div></div></section></div><section class="panel"><div class="section-heading"><h2>${L('محبوب‌ترین پکیج‌ها', 'Most Active Packages')}</h2><span>${L('دانلود / نصب / خطا', 'Downloads / Installs / Errors')}</span></div>${data.packages.length ? `<div class="ranking-list">${data.packages.map((p: any, i: number) => `<article><span class="rank-number">${num(i + 1)}</span><div><b>${esc(c.data.packages.find((q) => q.id === p.package_id)?.name || p.package_id)}</b><small>${num(Number(p.installs))} ${L('نصب', 'installs')} · ${num(Number(p.errors))} ${L('خطا', 'errors')}</small></div><strong>${num(Number(p.downloads))}</strong></article>`).join('')}</div>` : empty(L('هنوز رتبه‌بندی وجود ندارد', 'No package rankings yet'), L('با دریافت اولین رویداد واقعی، نمودار و رتبه‌بندی ساخته می‌شوند.', 'Package metrics appear once telemetry batches are submitted.'), 'package')}</section><p class="fine-print">${L('منبع: گزارش کلاینت‌های متصل به لایسنس. رویدادهای ارسال‌نشده یا اجرای پیش از فعال‌سازی در این آمار نیستند؛ این داده سند ضدتقلب یا شمارنده بازدید هاست خارجی نیست.', 'Source: authenticated license telemetry. Pre-activation or unsynced offline launches are excluded.')}</p>`;
    decorate();
  };
  el.querySelector('#analytics-days')!.addEventListener('change', () => void draw());
  el.querySelector('#analytics-metric')!.addEventListener('change', () => void draw());
  await draw();
}
