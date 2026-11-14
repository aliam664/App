import { api } from './api';
import { hasPermission, type Admin } from '../../../packages/contracts/src/index';
import { L, getLang, statusLabels } from './i18n';
import { esc, field, modal, busy, date, badge, empty, decorate, toast } from './ui';

export async function renderUsers(el: HTMLElement, admin: Admin, token: string) {
  const read = hasPermission(admin, 'users.read'),
    write = hasPermission(admin, 'users.manage');
  if (!read) {
    el.innerHTML = empty(
      L('فهرست کاربران برای این حساب پنهان است', 'User Directory Hidden for This Account'),
      write
        ? L(
            'مجوز ویرایش دارید، نه مشاهدهٔ فهرست. فقط با شناسهٔ دقیق می‌توانید مقادیر پروفایل را جایگزین کنید.',
            'You hold write-only profile access. Supply an exact license UUID to overwrite profile fields.',
          )
        : L('مجوز مشاهده را از مالک بخواهید.', 'Request users.read access from the owner.'),
      'lock-keyhole',
    );
    if (write) {
      el.innerHTML += `<button class="button" id="known-user">${L('ویرایش با شناسهٔ دقیق', 'Edit by Exact UUID')}</button>`;
      el.querySelector('#known-user')!.addEventListener('click', () => {
        const d = modal(
          L('ویرایش بدون مشاهدهٔ فهرست', 'Blind Profile Update'),
          `<form data-guard-discard><p class="notice">${L('اطلاعات فعلی دریافت نمی‌شود. ذخیره، نام و یادداشت و برچسب‌های قبلی را با مقادیر فرم جایگزین می‌کند؛ اعتبار و اتصال دستگاه تغییر نمی‌کند.', 'Existing metadata is not fetched. Submitting replaces name, notes, and tags without affecting license status or devices.')}</p>${field(L('شناسهٔ دقیق کاربر', 'Exact User / License UUID'), '<input name="id" required pattern="[a-f0-9-]{36}" dir="ltr">')}${field(L('نام نمایشی جایگزین', 'Replacement Display Name'), '<input name="display_name" maxlength="120">')}${field(L('یادداشت جایگزین', 'Replacement Notes'), '<textarea name="notes" maxlength="4000"></textarea>')}${field(L('برچسب‌های جایگزین؛ کامای انگلیسی', 'Replacement Tags (comma-separated)'), '<input name="tags" dir="ltr">')}<button type="submit" class="button full">${L('ذخیره مقادیر جایگزین', 'Save Replacement Fields')}</button></form>`,
        );
        d.querySelector('form')!.onsubmit = (e) => {
          e.preventDefault();
          void busy(d.querySelector('[type=submit]')!, async () => {
            const f = new FormData(e.target as HTMLFormElement);
            await api(
              `/admin/users/${f.get('id')}`,
              {
                display_name: f.get('display_name'),
                notes: f.get('notes'),
                tags: String(f.get('tags'))
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
              token,
            );
            d.close();
            toast(L('پروفایل ذخیره شد؛ فهرست همچنان محفوظ است.', 'Profile updated cleanly.'));
          });
        };
      });
    }
    return;
  }
  const { users } = await api<{
    users: {
      id: string;
      display_name: string;
      notes: string;
      tags: string[];
      tier: string;
      status: string;
      created_at: string;
      expires_at: string | null;
      archived: boolean;
    }[];
  }>('/admin/users', undefined, token);
  const statuses = statusLabels();
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>USER DIRECTORY</p><h1>${L('کاربران؛ مستقل از اختیارات لایسنس.', 'Users, Separate from Entitlements.')}</h1><p class="muted">${L('هر پروفایل به هویت لایسنس متصل است؛ ویرایش نام و یادداشت، اعتبار یا دستگاه را تغییر نمی‌دهد.', 'Profiles bind to license identities; metadata edits never alter tier, expiration, or bound devices.')}</p></div></div><div class="toolbar"><label class="search"><input id="user-search" aria-label="${L('جست‌وجوی کاربران', 'Search users')}" placeholder="${L('نام، شناسه یا برچسب', 'Name, UUID, or tag')}"></label><select id="user-tier" aria-label="${L('سطح کاربر', 'Filter by tier')}"><option value="all">${L('همه سطوح', 'All Tiers')}</option><option>normal</option><option>pro</option><option>vip</option></select><select id="user-order" aria-label="${L('ترتیب کاربران', 'Sort users')}"><option value="newest">${L('جدیدترین', 'Newest')}</option><option value="name">${L('نام', 'Name')}</option><option value="expires">${L('انقضا', 'Expiration')}</option></select></div><div class="panel table-panel" id="user-table"></div>`;
  const draw = () => {
    const q = (el.querySelector('#user-search') as HTMLInputElement).value.toLocaleLowerCase(),
      tier = (el.querySelector('#user-tier') as HTMLSelectElement).value,
      order = (el.querySelector('#user-order') as HTMLSelectElement).value;
    const rows = users
      .filter(
        (u) =>
          `${u.id} ${u.display_name} ${u.tags.join(' ')}`.toLocaleLowerCase().includes(q) &&
          (tier === 'all' || tier === u.tier),
      )
      .sort((a, b) =>
        order === 'name'
          ? a.display_name.localeCompare(b.display_name, getLang())
          : order === 'expires'
            ? (a.expires_at || '9999').localeCompare(b.expires_at || '9999')
            : b.created_at.localeCompare(a.created_at),
      );
    el.querySelector('#user-table')!.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>${L('کاربر', 'User')}</th><th>${L('سطح', 'Tier')}</th><th>${L('وضعیت', 'Status')}</th><th>${L('انقضا', 'Expires')}</th><th>${L('عملیات', 'Actions')}</th></tr></thead><tbody>${rows.map((u) => `<tr><td>${esc(u.display_name || L('نامشخص', 'Unnamed'))}<small class="cell-sub"><code dir="ltr">${esc(u.id)}</code></small></td><td>${badge(u.tier)}</td><td>${esc(statuses[u.status] || u.status)}</td><td>${date(u.expires_at)}</td><td><button class="text-button" data-user="${u.id}">${write ? L('ویرایش پروفایل', 'Edit Profile') : L('مشاهده پروفایل', 'View Profile')}</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(
          L('کاربری پیدا نشد', 'No matching users'),
          L('جست‌وجو و سطح انتخاب‌شده را بررسی کنید.', 'Adjust search terms or tier filter.'),
          'users',
        );
    el.querySelectorAll<HTMLButtonElement>('[data-user]').forEach(
      (b) =>
        (b.onclick = () => {
          const u = users.find((u) => u.id === b.dataset.user)!;
          const d = modal(
            L('پروفایل کاربر', 'User Profile'),
            `<form data-guard-discard><p class="fine-print">${L('شناسه', 'ID')} <code dir="ltr">${esc(u.id)}</code>${L('؛ مجوز پروفایل امکان تمدید، تغییر سطح یا آزادسازی دستگاه نمی‌دهد.', '; profile access never modifies duration, tier, or device binding.')}</p><fieldset ${write ? '' : 'disabled'}>${field(L('نام نمایشی', 'Display Name'), `<input name="display_name" maxlength="120" value="${esc(u.display_name)}">`)}${field(L('یادداشت داخلی', 'Internal Notes'), `<textarea name="notes" maxlength="4000">${esc(u.notes)}</textarea>`)}${field(L('برچسب‌ها؛ با کامای انگلیسی', 'Tags (comma-separated)'), `<input name="tags" dir="ltr" value="${esc(u.tags.join(', '))}">`)}</fieldset>${write ? `<button type="submit" class="button full">${L('ذخیره پروفایل کاربر', 'Save Profile')}</button>` : ''}</form>`,
          );
          d.querySelector('form')!.onsubmit = (e) => {
            e.preventDefault();
            if (!write) return;
            void busy(d.querySelector('[type=submit]')!, async () => {
              const f = new FormData(e.target as HTMLFormElement);
              await api(
                `/admin/users/${u.id}`,
                {
                  display_name: f.get('display_name'),
                  notes: f.get('notes'),
                  tags: String(f.get('tags'))
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                },
                token,
              );
              d.close();
              await renderUsers(el, admin, token);
              toast(L('پروفایل بدون تغییر اعتبار لایسنس ذخیره شد.', 'Profile updated.'));
            });
          };
          decorate();
        }),
    );
    decorate();
  };
  el.querySelector('#user-search')!.addEventListener('input', draw);
  el.querySelector('#user-tier')!.addEventListener('change', draw);
  el.querySelector('#user-order')!.addEventListener('change', draw);
  draw();
}
