import { api } from './api';
import type { PackageCategory } from '../../../packages/contracts/src/index';
import { modal, field, esc, busy, toast, decorate } from './ui';
export function manageCategories(
  categories: PackageCategory[],
  token: string,
  reload: () => Promise<void>,
) {
  const d = modal(
    'دسته‌بندی‌های پکیج',
    `<p class="muted">غیرفعال‌سازی، انتشار جدید در آن دسته را متوقف می‌کند؛ پکیج‌های قبلی را خودکار حذف نمی‌کند.</p><div class="category-list">${categories.map((c) => `<button class="setting-row" data-category-edit="${esc(c.id)}"><span>${esc(c.name)}<small dir="ltr">${esc(c.id)}</small></span><span>${c.enabled ? 'فعال' : 'غیرفعال'}</span></button>`).join('')}</div><button class="button full" id="category-new">دسته‌بندی جدید</button>`,
  );
  const edit = (c?: PackageCategory) => {
    const e = modal(
      c ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید',
      `<form data-guard-discard>${field('شناسه انگلیسی ثابت', `<input name="id" required pattern="[a-z0-9-]{2,64}" dir="ltr" value="${esc(c?.id || '')}" ${c ? 'readonly' : ''}>`)}${field('نام نمایشی', `<input name="name" required minlength="2" maxlength="80" value="${esc(c?.name || '')}">`)}<label class="setting-row"><span>برای انتشار جدید فعال باشد</span><input name="enabled" type="checkbox" ${!c || c.enabled ? 'checked' : ''}></label><button class="button full" type="submit">ذخیره دسته‌بندی</button></form>`,
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
        toast('دسته‌بندی و تاریخچه ثبت شد.');
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
