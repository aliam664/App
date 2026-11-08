import { z } from 'zod';
import { validatePublication, type PackageSpec } from '../../../packages/contracts/src/index';
import { esc, fa, size } from './ui';
/** Organizes the existing manifest editor; never performs browser-side installation. */
export function mountPackageBuilder(
  form: HTMLFormElement,
  read: () => PackageSpec,
  all: PackageSpec[],
) {
  const fieldset = form.querySelector('fieldset')!;
  const fileHeading = fieldset.querySelector('#file-rows')!.previousElementSibling!;
  const stepHeading = fieldset.querySelector('#install-steps')!.previousElementSibling!;
  const children = [...fieldset.children];
  let group = 0;
  const panels = [0, 1, 2, 3].map((i) => {
    const p = document.createElement('section');
    p.id = `builder-panel-${i}`;
    p.dataset.builderPanel = String(i);
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', `builder-tab-${i}`);
    return p;
  });
  for (const child of children) {
    if (child === fileHeading) group = 1;
    if (child === stepHeading) group = 2;
    panels[group].append(child);
  }
  panels.forEach((p) => fieldset.append(p));
  const tabs = document.createElement('div');
  tabs.className = 'builder-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'مراحل ساخت پکیج');
  const names = ['۱ · اطلاعات', '۲ · فایل‌ها', '۳ · مراحل نصب', '۴ · بازبینی'];
  tabs.innerHTML = names
    .map(
      (name, i) =>
        `<button type="button" role="tab" id="builder-tab-${i}" aria-controls="builder-panel-${i}" data-builder-tab="${i}">${name}</button>`,
    )
    .join('');
  form.prepend(tabs);
  form.noValidate = true;
  const controls = document.createElement('div');
  controls.className = 'builder-navigation';
  controls.innerHTML =
    '<button type="button" class="text-button" data-builder-prev>مرحله قبل</button><span class="muted" data-builder-position></span><button type="button" class="button secondary" data-builder-next>مرحله بعد</button>';
  fieldset.after(controls);
  let current = 0;
  function review() {
    try {
      const p = read();
      validatePublication(p, all);
      panels[3].innerHTML = `<div class="notice">ساختار تنظیمات معتبر است؛ دسترسی لینک، هش واقعی و فهرست فایل‌های داخل آرشیو فقط هنگام دانلود و استخراج Native تأیید می‌شوند.</div><h3>${esc(p.name)} · <code>${esc(p.version)}</code></h3><p>${fa(p.files.length)} فایل · ${size(p.files.reduce((n, f) => n + f.size, 0))} · ${fa(p.dependencies.length)} پیش‌نیاز</p><h3>مسیرهای اعلام‌شده به ترتیب اجرا</h3><ol class="builder-preview">${p.steps.map((s) => `<li><b>${s.action === 'extract' ? 'استخراج' : 'کپی'}</b> ${esc(p.files.find((f) => f.id === s.file_id)?.name || 'نامشخص')}<code dir="ltr">${esc(s.source_subdir || '(archive root)')} → ${esc(s.destination)}</code><small>${s.overwrite === 'fail' ? 'توقف در تداخل' : 'پیش‌نمایش، بکاپ و جایگزینی با تأیید کاربر'}</small></li>`).join('')}</ol><p class="fine-print">این نما، درخت حدس‌زدهٔ فایل‌های داخلی آرشیو نیست. پیش‌نمایش واقعی فایل‌ها پس از استخراج ایمن و پیش از تغییر بازی نشان داده می‌شود.</p>`;
    } catch (e) {
      const messages =
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
          : [e instanceof Error ? e.message : 'تنظیمات ناقص است'];
      panels[3].innerHTML = `<div role="alert" class="builder-errors"><h3>پیش از انتشار اصلاح کنید</h3><ul>${messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p>می‌توانید به مراحل قبلی برگردید؛ پیش‌نویس معتبرِ بدون فایل هم قابل ذخیره است.</p></div>`;
    }
  }
  function show(i: number) {
    current = Math.max(0, Math.min(3, i));
    panels.forEach((p, n) => (p.hidden = n !== current));
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b, n) => {
      b.setAttribute('aria-selected', String(n === current));
      b.tabIndex = n === current ? 0 : -1;
    });
    (controls.querySelector('[data-builder-prev]') as HTMLButtonElement).disabled = current === 0;
    (controls.querySelector('[data-builder-next]') as HTMLButtonElement).disabled = current === 3;
    controls.querySelector('[data-builder-position]')!.textContent =
      `مرحله ${fa(current + 1)} از ۴`;
    if (current === 3) review();
  }
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b, i) => (b.onclick = () => show(i)));
  tabs.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    show(e.key === 'Home' ? 0 : e.key === 'End' ? 3 : current + (e.key === 'ArrowLeft' ? 1 : -1));
    (tabs.children[current] as HTMLButtonElement).focus();
  };
  controls.querySelector('[data-builder-prev]')!.addEventListener('click', () => show(current - 1));
  controls.querySelector('[data-builder-next]')!.addEventListener('click', () => show(current + 1));
  show(0);
  return { show };
}
