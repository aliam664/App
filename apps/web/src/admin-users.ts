import { api } from './api';
import { hasPermission, type Admin } from '../../../packages/contracts/src/index';
import { esc, field, modal, busy, date, badge, empty, decorate, toast } from './ui';
export async function renderUsers(el: HTMLElement, admin: Admin, token: string) {
  const read = hasPermission(admin, 'users.read'),
    write = hasPermission(admin, 'users.manage');
  if (!read) {
    el.innerHTML = empty(
      'فهرست کاربران برای این حساب پنهان است',
      write
        ? 'مجوز ویرایش دارید، نه مشاهدهٔ فهرست. فقط با شناسهٔ دقیق می‌توانید مقادیر پروفایل را جایگزین کنید.'
        : 'مجوز مشاهده را از مالک بخواهید.',
      'lock-keyhole',
    );
    if (write) {
      el.innerHTML += '<button class="button" id="known-user">ویرایش با شناسهٔ دقیق</button>';
      el.querySelector('#known-user')!.addEventListener('click', () => {
        const d = modal(
          'ویرایش بدون مشاهدهٔ فهرست',
          `<form data-guard-discard><p class="notice">اطلاعات فعلی دریافت نمی‌شود. ذخیره، نام و یادداشت و برچسب‌های قبلی را با مقادیر فرم جایگزین می‌کند؛ اعتبار و اتصال دستگاه تغییر نمی‌کند.</p>${field('شناسهٔ دقیق کاربر', '<input name="id" required pattern="[a-f0-9-]{36}" dir="ltr">')}${field('نام نمایشی جایگزین', '<input name="display_name" maxlength="120">')}${field('یادداشت جایگزین', '<textarea name="notes" maxlength="4000"></textarea>')}${field('برچسب‌های جایگزین؛ کامای انگلیسی', '<input name="tags">')}<button type="submit" class="button full">ذخیره مقادیر جایگزین</button></form>`,
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
            toast('پروفایل ذخیره شد؛ فهرست همچنان محفوظ است.');
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
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">USER DIRECTORY</p><h1>کاربران؛ مستقل از اختیارات لایسنس.</h1><p class="muted">هر پروفایل به هویت لایسنس متصل است؛ ویرایش نام و یادداشت، اعتبار یا دستگاه را تغییر نمی‌دهد.</p></div></div><div class="toolbar"><label class="search"><input id="user-search" aria-label="جست‌وجوی کاربران" placeholder="نام، شناسه یا برچسب"></label><select id="user-tier" aria-label="سطح کاربر"><option value="all">همه سطوح</option><option>normal</option><option>pro</option><option>vip</option></select><select id="user-order" aria-label="ترتیب کاربران"><option value="newest">جدیدترین</option><option value="name">نام</option><option value="expires">انقضا</option></select></div><div class="panel table-panel" id="user-table"></div>`;
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
          ? a.display_name.localeCompare(b.display_name, 'fa')
          : order === 'expires'
            ? (a.expires_at || '9999').localeCompare(b.expires_at || '9999')
            : b.created_at.localeCompare(a.created_at),
      );
    el.querySelector('#user-table')!.innerHTML = rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>کاربر</th><th>سطح</th><th>وضعیت</th><th>انقضا</th><th>عملیات</th></tr></thead><tbody>${rows.map((u) => `<tr><td>${esc(u.display_name || 'نامشخص')}<small class="cell-sub"><code>${esc(u.id)}</code></small></td><td>${badge(u.tier)}</td><td>${esc(({ active: 'فعال', unused: 'فعال‌نشده', scheduled: 'شروع در آینده', expired: 'منقضی', suspended: 'معلق', revoked: 'مسدود / لغوشده' } as Record<string, string>)[u.status] || u.status)}</td><td>${date(u.expires_at)}</td><td><button class="text-button" data-user="${u.id}">${write ? 'ویرایش پروفایل' : 'مشاهده پروفایل'}</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('کاربری پیدا نشد', 'جست‌وجو و سطح انتخاب‌شده را بررسی کنید.', 'users');
    el.querySelectorAll<HTMLButtonElement>('[data-user]').forEach(
      (b) =>
        (b.onclick = () => {
          const u = users.find((u) => u.id === b.dataset.user)!;
          const d = modal(
            'پروفایل کاربر',
            `<form data-guard-discard><p class="fine-print">شناسه <code>${esc(u.id)}</code>؛ مجوز پروفایل امکان تمدید، تغییر سطح یا آزادسازی دستگاه نمی‌دهد.</p><fieldset ${write ? '' : 'disabled'}>${field('نام نمایشی', `<input name="display_name" maxlength="120" value="${esc(u.display_name)}">`)}${field('یادداشت داخلی', `<textarea name="notes" maxlength="4000">${esc(u.notes)}</textarea>`)}${field('برچسب‌ها؛ با کامای انگلیسی', `<input name="tags" value="${esc(u.tags.join(', '))}">`)}</fieldset>${write ? '<button type="submit" class="button full">ذخیره پروفایل کاربر</button>' : ''}</form>`,
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
              toast('پروفایل بدون تغییر اعتبار لایسنس ذخیره شد.');
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
