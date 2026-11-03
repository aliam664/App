import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const widths = [320, 390, 640, 700, 701, 900, 1280, 1440];
async function owner(page: Page) {
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
}
async function nav(page: Page, id: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(`[data-nav="${id}"]`).click();
  await expect(page.locator('#content')).not.toHaveAttribute('aria-busy', 'true');
}
for (const theme of ['dark', 'light'])
  test(`all owner and user screens: ${theme}, WCAG checks and eight responsive widths`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => localStorage.setItem('uhm-theme', t), theme);
    await owner(page);
    const evidence: unknown[] = [];
    for (const mode of ['admin', 'user']) {
      if (mode === 'user') await page.locator('#switch-mode').click();
      const pages =
        mode === 'admin'
          ? [
              'dashboard',
              'licenses',
              'packages',
              'versions',
              'devices',
              'analytics',
              'errors',
              'team',
              'service',
              'logs',
              'settings',
            ]
          : ['discover', 'content', 'library-settings', 'library', 'downloads', 'settings'];
      for (const id of pages) {
        await nav(page, id);
        // Real local API; no production license, no mocked statistics.
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        const violations = result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        }));
        evidence.push({ mode, page: id, theme, violations });
        expect(violations, `${mode}/${id}/${theme}`).toEqual([]);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${mode}/${id}/${theme}/${width}: document overflow`,
          ).toBe(true);
        }
      }
    }
    await info.attach('accessibility-results', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
test('mobile menu exposes every permitted owner destination; tablet labels remain readable', async ({
  page,
}) => {
  await owner(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole('button', { name: 'تیم و دسترسی‌ها', exact: true })).toBeVisible();
  expect(
    await page.locator('[data-nav=team] span').evaluate((el) => getComputedStyle(el).display),
  ).not.toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'منوی بخش‌ها', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /UHM/ });
  await expect(dialog.getByRole('button', { name: 'کنترل سرویس', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'تیم و دسترسی‌ها', exact: true }).click();
  await expect(page.locator('#content')).toContainText('تیم');
  await expect(page.getByRole('button', { name: 'منوی بخش‌ها' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
test('navigation survives refresh, browser history and Pages-compatible deep links', async ({
  page,
}) => {
  await owner(page);
  await nav(page, 'packages');
  await expect(page).toHaveURL(/#\/admin\/packages$/);
  await nav(page, 'licenses');
  await page.goBack();
  await expect(page.locator('#content')).toContainText('محتوا را شما می‌سازید');
  await page.reload();
  await expect(page.locator('#content')).toContainText('محتوا را شما می‌سازید');
  await page.locator('#switch-mode').click();
  await nav(page, 'library');
  await page.reload();
  await expect(page.locator('#content')).toContainText('کتابخانه محلی در نسخه ویندوز');
});
test('package studio is labelled, fits a phone, protects unsaved work and restores focus', async ({
  page,
}) => {
  await owner(page);
  await page.locator('#quick-package').click();
  const dialog = page.getByRole('dialog', { name: 'ساخت پکیج جدید' });
  await expect(dialog).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.locator('[name=name]').fill('تغییر ذخیره‌نشده');
  page.once('dialog', (d) => d.dismiss());
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(dialog).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#quick-package')).toBeFocused();
  expect(await page.locator('html').getAttribute('class')).not.toContain('has-modal');
});
test('user category tabs support RTL keyboard navigation and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.hero-video')).not.toHaveAttribute('autoplay');
  const first = page.getByRole('tab', { name: 'همه پکیج‌ها', exact: true });
  await first.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'گرافیک و نور', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await nav(page, 'settings');
  await page.locator('#language').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
test('temporary overview failure offers a working retry instead of a dead end', async ({
  page,
}) => {
  await owner(page);
  let broken = true;
  await page.route('**/api/admin/overview', (route) =>
    broken
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"SERVICE_PAUSED"}',
        })
      : route.continue(),
  );
  await page.locator('#admin-refresh').click();
  await expect(page.getByRole('button', { name: 'تلاش دوباره', exact: true })).toBeVisible();
  broken = false;
  await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
});

test('skip link focuses the page without changing the owner route', async ({ page }) => {
  await owner(page);
  const skip = page.getByRole('link', { name: 'رفتن به محتوای صفحه', exact: true });
  await skip.focus();
  await skip.press('Enter');
  await expect(page.locator('#content')).toBeFocused();
  await expect(page).toHaveURL(/#\/admin$/);
});
test('owner license and team dialogs have accessible controls and readable light theme', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('uhm-theme', 'light'));
  await owner(page);
  await page.locator('#quick-license').click();
  let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await nav(page, 'licenses');
  await page.locator('[data-license]').first().click();
  result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
  await nav(page, 'team');
  await page.locator('#new-member').click();
  await expect(page.getByRole('dialog', { name: 'مجوزهای حساب مدیریتی' })).toBeVisible();
  result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
});

test('compact preference reduces console spacing and persists after reload', async ({ page }) => {
  await owner(page);
  const before = await page
    .locator('#content')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  await nav(page, 'settings');
  await page.locator('#compact').check();
  const after = await page
    .locator('#content')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(after).toBeLessThan(before);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/compact/);
});
