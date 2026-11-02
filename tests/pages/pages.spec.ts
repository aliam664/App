import { expect, test } from '@playwright/test';

test('compiled /App/ site uses the shared UI with working assets and no API server', async ({
  page,
}) => {
  const errors: string[] = [],
    failed: string[] = [],
    apiRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api')) apiRequests.push(r.url());
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /گرافیک استو را/ })).toBeVisible();
  await expect(page.locator('.demo-strip')).toContainText('GitHub Pages');
  await expect(page.locator('.package-card')).toHaveCount(6);
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/App/brand/logo.png');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].filter((i) => i.loading !== 'lazy').map((i) => i.decode()),
    );
  });
  expect(await page.evaluate(() => document.fonts.check('16px "UHM Outfit"'))).toBe(true);
  await page.getByRole('tab', { name: 'مسیرها', exact: true }).click();
  await expect(page.locator('.package-card')).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('sandbox activation and admin actions survive reload without a real backend', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'فعال‌سازی لایسنس', exact: true }).click();
  await page.getByRole('button', { name: 'استفاده از لایسنس آزمایشی Pro' }).click();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
  await page.reload();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
  await page.getByRole('button', { name: 'منوی بخش‌ها' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'پنل مدیریت', exact: true }).click();
  await page.getByRole('button', { name: 'ورود به پنل نمایشی' }).click();
  await expect(page).toHaveURL(/\/App\/#\/admin$/);
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.getByRole('button', { name: 'لایسنس‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'تولید لایسنس', exact: true }).click();
  await page.getByRole('button', { name: 'تولید و نمایش کدها' }).click();
  await expect(page.locator('#codes')).toHaveValue(/UHM-/);
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت به لانچر', exact: true }).click();
  await expect(page).toHaveURL(/\/App\/$/);
  await expect(page.getByRole('heading', { name: /گرافیک استو را/ })).toBeVisible();
});

test('hash deep link, root link, browser history and mobile layout work under /App/', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی' }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.getByRole('button', { name: 'منوی بخش‌ها' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'بازگشت به لانچر', exact: true })
    .click();
  await expect(page).toHaveURL(/\/App\/$/);
  await expect(page.locator('.feature')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.getByRole('link', { name: 'UHM Launcher' }).click();
  await expect(page).toHaveURL(/\/App\/$/);
});
