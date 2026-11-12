import { api } from './api';
import type { PackageCategory } from '../../../packages/contracts/src/index';
import { L } from './i18n';
import { modal, field, esc, busy, toast, decorate } from './ui';

export function manageCategories(
  categories: PackageCategory[],
  token: string,
  reload: () => Promise<void>,
) {
  const d = modal(
    L('دسته‌بندی‌های پکیج', 'Package Categories'),
    `<p class="muted">${L('غیرفعال‌سازی، انتشار جدید در آن دسته را متوقف می‌کند؛ پکیج‌های قبلی را خودکار حذف نمی‌کند.', 'Disabling a category pauses new publications into it without removing existing releases.')}</p><div class="category-list">${categories.map((c) => `<button class="setting-row" data-category-edit="${esc(c.id)}"><span>${esc(c.name)} <small dir="ltr">${esc(c.id)}</small></span><span>${c.enabled ? L('فعال', 'Enabled') : L('غیرفعال', 'Disabled')}</span></button>`).join('')}</div><button class="button full" id="category-new">${L('دسته‌بندی جدید', 'New Category')}</button>`,
  );
  const edit = (c?: PackageCategory) => {
    const e = modal(
      c ? L('ویرایش دسته‌بندی', 'Edit Category') : L('دسته‌بندی جدید', 'New Category'),
      `<form data-guard-discard>${field(L('شناسه انگلیسی ثابت', 'Slug ID'), `<input name="id" required pattern="[a-z0-9-]{2,64}" dir="ltr" value="${esc(c?.id || '')}" ${c ? 'readonly' : ''}>`)}${field(L('نام نمایشی', 'Display Name'), `<input name="name" required minlength="2" maxlength="80" value="${esc(c?.name || '')}">`)}<label class="setting-row"><span>${L('برای انتشار جدید فعال باشد', 'Enabled for new releases')}</span><input name="enabled" type="checkbox" ${!c || c.enabled ? 'checked' : ''}></label><button class="button full" type="submit">${L('ذخیره دسته‌بندی', 'Save Category')}</button></form>`,
    );
    e.querySelector('form')!.onsubmit = (event) => {
      event.preventDefault();
      void busy(e.querySelector('[type=submit]')!, async () => {
        const f = new FormData(event.target as HTMLFormElement);
        await api(
          `/admin/categories/${f.get('id')}`,
          { name: f.get('name'), enabled: f.has('enabled'), expected_version: c?.version || 0 },
          token,
        );
        e.close();
        d.close();
        await reload();
        toast(L('دسته‌بندی و تاریخچه ثبت شد.', 'Category updated with audit entry.'));
      });
    };
    decorate();
  };
  d.querySelector('#category-new')!.addEventListener('click', () => edit());
  d.querySelectorAll<HTMLButtonElement>('[data-category-edit]').forEach(
    (b) => (b.onclick = () => edit(categories.find((c) => c.id === b.dataset.categoryEdit))),
  );
  decorate();
}
