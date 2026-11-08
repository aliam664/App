import { test, expect } from '@playwright/test';
test('raw branch index recovers to compiled shared UI instead of a white screen', async ({
  page,
}) => {
  await page.route('https://branch.github.io/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `http://127.0.0.1:5182${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto('https://branch.github.io/App/');
  await expect(page).toHaveURL('https://branch.github.io/App/pages-preview/');
  await expect(page.getByRole('heading', { name: /گرافیک استو را/ })).toBeVisible();
  await expect(page.locator('.package-card')).toHaveCount(6);
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/App/public/brand/logo.png');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.querySelector<HTMLImageElement>('.brand img')!.decode();
  });
  expect(await page.evaluate(() => document.fonts.check('16px "UHM Outfit"'))).toBe(true);
  await page.getByRole('button', { name: 'پنل مدیریت', exact: true }).click();
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
});
