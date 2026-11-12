import { test, expect } from '@playwright/test';
test('launcher catalog is searchable, filterable and never fabricates installation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /دقت مهندسی برای/ })).toBeVisible();
  await expect(page.locator('.package-card')).toHaveCount(6);
  await page.getByRole('tab', { name: 'مسیرها', exact: true }).click();
  await expect(page.locator('.package-card')).toHaveCount(1);
  await page.getByRole('tab', { name: 'همه پکیج‌ها', exact: true }).click();
  await page.getByRole('textbox', { name: 'جست‌وجوی پکیج' }).fill('پایه');
  await expect(page.locator('.package-card')).toHaveCount(1);
  await page.locator('.card-title').click();
  await expect(page.getByRole('dialog')).toContainText('نصب فایل تنها در برنامه ویندوز');
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: 'کتابخانه من', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'کتابخانه محلی در نسخه ویندوز' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('demo activation performs cryptographic device flow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'فعال‌سازی لایسنس', exact: true }).click();
  await page.getByRole('button', { name: 'استفاده از لایسنس آزمایشی Pro' }).click();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
  await page.locator('.profile').click();
  await expect(page.getByRole('dialog')).toContainText('عضویت PRO');
  await page.getByRole('button', { name: 'تمدید مجوز آنلاین' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
});
test('admin can generate licenses, search and persist a package draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'پنل مدیریت', exact: true }).click();
  await page.getByRole('button', { name: 'ورود به پنل نمایشی' }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.getByRole('button', { name: 'لایسنس‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'تولید لایسنس', exact: true }).click();
  await page.getByRole('button', { name: 'تولید و نمایش کدها' }).click();
  await expect(page.locator('#codes')).toHaveValue(/UHM-/);
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: 'پکیج‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'پکیج جدید', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[name=name]').fill('پکیج تست مرورگر');
  await dialog.locator('[name=slug]').fill(`e2e-${Date.now()}`);
  await dialog
    .locator('[name=description]')
    .fill('این یک پکیج آزمایشی برای بررسی ذخیره واقعی در API است.');
  await page.getByRole('button', { name: 'ذخیره پیش‌نویس', exact: true }).click();
  await expect(page.locator('table')).toContainText('پکیج تست مرورگر');
  await page.getByRole('button', { name: 'نسخه‌ها', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'هر انتشار، یک نقطهٔ بازگشت.' })).toBeVisible();
  await page.getByRole('button', { name: 'رویدادها', exact: true }).click();
  await expect(page.locator('table')).toContainText('package.draft.saved');
});
test('responsive launcher has no horizontal overflow at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.feature')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'منوی بخش‌ها' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'دانلود و نصب', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'صف دانلود خالی است' })).toBeVisible();
  await page.getByRole('button', { name: 'منوی بخش‌ها' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تنظیمات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'گاراژ، به سلیقهٔ تو.' })).toBeVisible();
});

test('corrupt cached license cannot prevent launcher startup', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('uhm-license', 'invalid-json'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /دقت مهندسی برای/ })).toBeVisible();
});

test('Assetto Corsa Launcher brand identity, editorial art, FA/EN toggle and persistent theme work together', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.reference-header .brand img')).toHaveAttribute(
    'src',
    '/brand/mark.svg',
  );
  await expect(page.locator('.reference-header .brand')).toContainText('Assetto Corsa Launcher');
  await expect(page.locator('.reference-header')).not.toContainText('UHM');
  await expect(page.locator('.hero .hero-highlight')).toHaveText('گاراژ استو کورسا');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase(),
    ),
  ).toBe('#0B0C0E');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
    ),
  ).toBe('#C81E2B');
  expect(
    await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.hero-visual img');
      return !!img && img.complete && img.naturalWidth > 0;
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'تغییر تم', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#header-lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: /Engineered Precision for/ })).toBeVisible();
  await page.locator('#header-lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await page.getByRole('button', { name: /مرور کاتالوگ پکیج‌ها/ }).click();
  await expect(page.locator('#package-catalog')).toBeInViewport();
  await page.locator('[data-nav="library"]').click();
  await expect(page.getByRole('heading', { name: 'کتابخانه محلی در نسخه ویندوز' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Contact Us starts empty cleanly, lets admin configure channels and publishes safely', async ({
  page,
  request,
}) => {
  const token = (await (await request.post('/api/demo/session', { data: {} })).json()).token;
  const resetContact = async () => {
    const cur = await (
      await request.get('/api/admin/contact', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    if (cur.configured) {
      await request.post('/api/admin/contact', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          headline_fa: '',
          headline_en: '',
          intro_fa: '',
          intro_en: '',
          email: '',
          phone: '',
          telegram: '',
          discord: '',
          instagram: '',
          youtube: '',
          website: '',
          support_hours_fa: '',
          support_hours_en: '',
          location_fa: '',
          location_en: '',
          response_note_fa: '',
          response_note_en: '',
          extra_links: [],
          expected_version: cur.contact.version,
        },
      });
    }
  };
  await resetContact();
  try {
    await page.goto('/');
    await expect(page.locator('.home-contact-band')).toHaveCount(0);
    await page.locator('[data-nav="contact"]').click();
    await expect(
      page.getByRole('heading', { name: 'هنوز راه ارتباطی ثبت نشده است' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'پنل مدیریت', exact: true }).click();
    await page.getByRole('button', { name: 'ورود به پنل نمایشی' }).click();
    await page.locator('[data-nav="contact"]').click();
    await expect(page.getByRole('heading', { name: 'مدیریت اطلاعات تماس با ما' })).toBeVisible();

    await page.locator('[name=headline_fa]').fill('پشتیبانی فنی استو کورسا');
    await page.locator('[name=headline_en]').fill('Assetto Corsa Technical Desk');
    await page.locator('[name=email]').fill('support@example.com');
    await page.locator('[name=telegram]').fill('@ac_support_desk');
    await page.locator('[name=discord]').fill('https://discord.gg/ac-desk');
    await page.getByRole('button', { name: 'ذخیره و انتشار در تماس با ما', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('ذخیره');

    await page.getByRole('button', { name: 'بازگشت به لانچر', exact: true }).click();
    await expect(page.locator('.home-contact-band')).toBeVisible();
    await page.locator('#home-open-contact').click();
    await expect(page.getByRole('heading', { name: 'پشتیبانی فنی استو کورسا' })).toBeVisible();
    await expect(page.locator('.contact-grid')).toContainText('support@example.com');
    await expect(page.locator('.contact-grid a[href="mailto:support@example.com"]')).toBeVisible();
    await expect(
      page.locator('.contact-grid a[href="https://t.me/ac_support_desk"]'),
    ).toBeVisible();
    await expect(page.locator('.contact-grid')).not.toContainText('اینستاگرام');

    await page.locator('#header-lang').click();
    await expect(page.getByRole('heading', { name: 'Assetto Corsa Technical Desk' })).toBeVisible();
    await page.locator('#header-lang').click();
  } finally {
    await resetContact();
  }
});

test('moving the HTML entry to the repository root does not expose local secrets', async ({
  request,
}) => {
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const file = resolve('.local/fs-deny-probe.txt');
  const marker = 'private-local-data-must-not-be-served';
  await mkdir('.local', { recursive: true });
  await writeFile(file, marker);
  try {
    for (const path of ['/.local/fs-deny-probe.txt', `/@fs${file}`]) {
      const result = await request.get(path);
      expect(result.status()).toBe(403);
      expect(await result.text()).not.toContain(marker);
    }
  } finally {
    await rm(file, { force: true });
  }
});

test('private operator handoff is denied by both direct and Vite filesystem routes', async ({
  request,
}) => {
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const file = resolve('operator-private/fs-deny-probe.txt');
  const marker = 'private-operator-handoff-must-not-be-served';
  await mkdir('operator-private', { recursive: true, mode: 0o700 });
  await writeFile(file, marker, { mode: 0o600 });
  try {
    for (const path of [
      '/operator-private/fs-deny-probe.txt',
      `/@fs${file}`,
      '/operator-private/fs-deny-probe.txt?raw',
      '/operator%2dprivate/fs-deny-probe.txt?raw',
      '/operator-private%2ffs-deny-probe.txt?import',
      `/@fs${file}?import`,
    ]) {
      const response = await request.get(path);
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain(marker);
    }
  } finally {
    await rm(file, { force: true });
  }
});
