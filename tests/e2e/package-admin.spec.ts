import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function owner(page: Page, request: APIRequestContext) {
  const token = (await (await request.post('/api/demo/session', { data: {} })).json()).token;
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await expect(page.locator('[data-nav=users]')).toBeVisible();
  return { Authorization: `Bearer ${token}` };
}
async function capture(page: Page, name: string) {
  if (!process.env.UHM_CAPTURE_GUIDE) return;
  await mkdir('test-results/mission-guide', { recursive: true });
  await page.screenshot({ path: `test-results/mission-guide/${name}.png`, fullPage: false });
}
test('user directory is reachable and edits only profile metadata through the real API', async ({
  page,
  request,
}) => {
  const headers = await owner(page, request);
  const issued = await (
    await request.post('/api/admin/licenses', {
      headers,
      data: { tier: 'pro', duration_days: 30, count: 1 },
    })
  ).json();
  const id = issued.licenses[0].id;
  await page.locator('[data-nav=users]').click();
  await expect(
    page.getByRole('heading', { name: 'کاربران؛ مستقل از اختیارات لایسنس.' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'جست‌وجوی کاربران' }).fill(id);
  await page.locator(`[data-user="${id}"]`).click();
  await page.locator('[name=display_name]').fill('کاربر آزمایشگاه');
  await page.locator('[name=notes]').fill('پروفایل جدا از مجوز تمدید و دستگاه');
  await page.locator('[name=tags]').fill('qa, isolated');
  await page.getByRole('button', { name: 'ذخیره پروفایل کاربر', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'جست‌وجوی کاربران' }).fill('کاربر آزمایشگاه');
  await expect(page.locator('#user-table')).toContainText('کاربر آزمایشگاه');
  const users = await (await request.get('/api/admin/users', { headers })).json();
  expect(users.users.find((u: any) => u.id === id)).toMatchObject({
    display_name: 'کاربر آزمایشگاه',
    tier: 'pro',
    status: 'unused',
    tags: ['qa', 'isolated'],
  });
  await capture(page, 'users');
});
test('four-step builder calculates a real local hash, reports validation errors and publishes stored manifests', async ({
  page,
  request,
}) => {
  const headers = await owner(page, request);
  await page.locator('[data-nav=packages]').click();
  await page.getByRole('button', { name: 'پکیج جدید', exact: true }).click();
  await page.getByRole('tab', { name: '۴ · بازبینی', exact: true }).click();
  await expect(page.locator('[role=alert].builder-errors')).toContainText(
    'پیش از انتشار اصلاح کنید',
  );
  await page.getByRole('tab', { name: '۱ · اطلاعات', exact: true }).click();
  const slug = 'wizard-' + Date.now();
  await page.locator('[name=name]').fill('بستهٔ کوچک آزمایشگاهی');
  await page.locator('[name=slug]').fill(slug);
  await page
    .locator('textarea[name=description]')
    .fill('بستهٔ مصنوعی برای آزمون رابط؛ نصب Native جداگانه روی پوشهٔ موقت اجرا می‌شود.');
  await capture(page, 'builder-metadata');
  await page.getByRole('tab', { name: '۲ · فایل‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'افزودن فایل', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'انتخاب فایل و محاسبهٔ هش / حجم', exact: true }).click();
  await (await chooser).setFiles('tests/fixtures/package-smoke.zip');
  const bytes = await readFile('tests/fixtures/package-smoke.zip');
  await expect(page.locator('[data-f=sha256]')).toHaveValue(
    createHash('sha256').update(bytes).digest('hex'),
  );
  await expect(page.locator('[data-f=size]')).toHaveValue(String(bytes.length));
  await expect(page.locator('[data-f=name]')).toHaveValue('package-smoke.zip');
  await page.locator('[data-f=format]').selectOption('zip');
  await page.locator('[data-f=url]').fill('https://example.com/fixture.zip');
  await capture(page, 'builder-files');
  await page.getByRole('tab', { name: '۳ · مراحل نصب', exact: true }).click();
  await page.locator('[data-step=destination]').fill('content/cars/uhm_fixture_car');
  await page.locator('[data-step=source_subdir]').fill('bundle/car');
  await capture(page, 'builder-steps');
  await page.getByRole('tab', { name: '۴ · بازبینی', exact: true }).click();
  await expect(page.locator('.builder-preview')).toContainText('content/cars/uhm_fixture_car');
  await expect(page.locator('.builder-errors')).toHaveCount(0);
  await capture(page, 'builder-review');
  await page.getByRole('button', { name: 'ذخیره پیش‌نویس', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const data = await (await request.get('/api/admin/overview', { headers })).json();
  const pkg = data.packages.find((p: any) => p.slug === slug);
  expect(pkg.revision).toBe(1);
  await page.locator(`[data-edit="${pkg.id}"]`).click();
  await page.getByRole('button', { name: 'اعتبارسنجی سرور', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'ساختار ذخیره‌شده معتبر' }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'انتشار نسخه', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const catalog = await (await request.get('/api/catalog')).json();
  expect(catalog.packages.some((p: any) => p.id === pkg.id)).toBe(true);
  expect(catalog.packages.find((p: any) => p.id === pkg.id)).not.toHaveProperty('files');
  await page.locator(`[data-edit="${pkg.id}"]`).click();
  page.once('dialog', (d) => d.accept(slug));
  await page.getByRole('button', { name: 'حذف پکیج از کاتالوگ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await (await request.get('/api/catalog')).json()).packages.some((p: any) => p.id === pkg.id),
  ).toBe(false);
});
test('category labels remain text in both catalog tabs and package selectors', async ({
  page,
  request,
}) => {
  const headers = await owner(page, request);
  await page.locator('[data-nav=packages]').click();
  await page.getByRole('button', { name: 'دسته‌بندی‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'دسته‌بندی جدید', exact: true }).click();
  const id = 'qa-' + Date.now();
  await page.locator('[name=id]').fill(id);
  await page.locator('[name=name]').fill('تجربهٔ آزمایشگاهی');
  await page.getByRole('button', { name: 'ذخیره دسته‌بندی', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'دسته‌بندی‌ها', exact: true }).click();
  await expect(page.locator(`[data-category-edit="${id}"]`)).toContainText('تجربهٔ آزمایشگاهی');
  await capture(page, 'categories');
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  const text = '<img src=x onerror=window.__cat=1>';
  expect(
    (
      await request.post(`/api/admin/categories/${id}`, {
        headers,
        data: { name: text, enabled: true, expected_version: 1 },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'پکیج جدید', exact: true }).click();
  await expect(page.locator(`[name=category] option[value="${id}"]`)).toHaveText(text);
  expect(await page.evaluate(() => Object.hasOwn(window, '__cat'))).toBe(false);
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.getByRole('button', { name: 'بازگشت به لانچر', exact: true }).click();
  await expect(page.locator(`[data-category="${id}"]`)).toHaveText(text);
  expect(await page.evaluate(() => Object.hasOwn(window, '__cat'))).toBe(false);
  await request.post(`/api/admin/categories/${id}`, {
    headers,
    data: { name: 'تجربهٔ آزمایشگاهی', enabled: true, expected_version: 2 },
  });
});
test('users.manage without users.read gets a known-ID write form, not a leaked directory', async ({
  page,
  request,
}) => {
  const token = (await (await request.post('/api/demo/session', { data: {} })).json()).token;
  const headers = { Authorization: `Bearer ${token}` };
  const generated = await (
    await request.post('/api/admin/licenses', {
      headers,
      data: { tier: 'normal', duration_days: 1, count: 1 },
    })
  ).json();
  const id = generated.licenses[0].id;
  await request.post(`/api/admin/team/${id}`, {
    headers,
    data: { role: 'viewer', permissions: ['users.manage'], enabled: true },
  });
  await page.goto('/#/admin');
  await page.locator('#license-admin-login input').fill(generated.codes[0]);
  await page.getByRole('button', { name: 'ورود با لایسنس این دستگاه', exact: true }).click();
  await page.locator('[data-nav=users]').click();
  await expect(
    page.getByRole('heading', { name: 'فهرست کاربران برای این حساب پنهان است' }),
  ).toBeVisible();
  await expect(page.locator('#user-table')).toHaveCount(0);
  await page.getByRole('button', { name: 'ویرایش با شناسهٔ دقیق', exact: true }).click();
  await page.locator('[name=id]').fill(id);
  await page.locator('[name=display_name]').fill('ویرایش محدود');
  await page.getByRole('button', { name: 'ذخیره مقادیر جایگزین', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const users = await (await request.get('/api/admin/users', { headers })).json();
  expect(users.users.find((u: any) => u.id === id).display_name).toBe('ویرایش محدود');
  await expect(page.locator('[data-nav=licenses]')).toBeHidden();
});
