import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
async function staff(request: APIRequestContext, page: Page, permissions: string[]) {
  // Real local API, device-proof login and assigned permissions. Never the production owner.
  const owner = await (await request.post('/api/demo/session', { data: {} })).json();
  const headers = { Authorization: `Bearer ${owner.token}` };
  const generated = await (
    await request.post('/api/admin/licenses', {
      headers,
      data: { tier: 'vip', count: 1, duration_days: 30 },
    })
  ).json();
  const access = await request.post(`/api/admin/team/${generated.licenses[0].id}`, {
    headers,
    data: { role: 'viewer', permissions, enabled: true },
  });
  expect(access.ok()).toBe(true);
  const file = crypto.randomUUID(),
    id = crypto.randomUUID();
  const saved = await request.post('/api/admin/packages', {
    headers,
    data: {
      id,
      slug: 'audit-' + id,
      name: 'Audit publisher fixture',
      description: 'Local browser permission audit fixture',
      category: 'cars',
      tier: 'normal',
      image: '/images/01.jpg',
      version: '1.0.0',
      changelog: '',
      dependencies: [],
      status: 'draft',
      released_at: null,
      files: [
        {
          id: file,
          name: 'fixture.zip',
          format: 'zip',
          url: 'https://files.example.com/fixture.zip',
          size: 100,
          sha256: 'a'.repeat(64),
        },
      ],
      steps: [
        {
          id: crypto.randomUUID(),
          file_id: file,
          action: 'extract',
          destination: 'content/cars',
          overwrite: 'backup',
        },
      ],
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/#/admin');
  await page.locator('#license-admin-login input').fill(generated.codes[0]);
  await page.getByRole('button', { name: 'ورود با لایسنس این دستگاه', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  return id;
}
test('custom editor can edit package fields but cannot publish', async ({ page, request }) => {
  const id = await staff(request, page, ['content.read', 'content.write']);
  await page.getByRole('button', { name: 'پکیج‌ها', exact: true }).click();
  await page.locator(`[data-edit="${id}"]`).click();
  await expect(page.locator('[name=name]')).toBeEnabled();
  await expect(page.locator('#publish-package')).toHaveCount(0);
  await expect(page.locator('#validate-package')).toHaveCount(0);
});
test('AUD-02: publisher without content.write should have an enabled publish button', async ({
  page,
  request,
}) => {
  const id = await staff(request, page, ['content.read', 'content.publish']);
  await page.getByRole('button', { name: 'پکیج‌ها', exact: true }).click();
  await page.locator(`[data-edit="${id}"]`).click();
  await expect(page.locator('[name=name]')).toBeDisabled();
  await expect(page.locator('#publish-package')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'ذخیره پیش‌نویس', exact: true })).toHaveCount(0);
  await page.locator('#validate-package').click();
  await expect(page.locator('.toast').last()).toContainText('ساختار ذخیره‌شده معتبر است');
});
test('AUD-03: content.write without content.read should expose a route to adding a package', async ({
  page,
  request,
}) => {
  await staff(request, page, ['content.write']);
  await expect(page.getByRole('button', { name: 'پکیج‌ها', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'پکیج‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'پکیج جدید', exact: true }).click();
  await expect(page.locator('[name=name]')).toBeEnabled();
});
