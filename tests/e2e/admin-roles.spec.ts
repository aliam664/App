import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('reusable roles are created in the real local API, combined on a member and exposed as grouped independent grants', async ({
  page,
  request,
}) => {
  const token = (await (await request.post('/api/demo/session', { data: {} })).json()).token;
  const headers = { Authorization: `Bearer ${token}` };
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await page.locator('[data-nav=team]').click();
  await page.getByRole('button', { name: 'ساخت نقش', exact: true }).click();
  const editor = page.locator('#custom-role-form');
  await editor.locator('[name=name]').fill('مدیر گزارش ' + Date.now());
  await editor
    .locator('[name=description]')
    .fill('مشاهدهٔ لایسنس و آمار؛ بدون مجوز صدور و بدون تغییر محتوا');
  await editor.locator('[value="licenses.read"]').check();
  await editor.locator('[value="analytics.read"]').check();
  await expect(editor.getByRole('group', { name: 'لایسنس و دستگاه', exact: true })).toBeVisible();
  await expect(editor.locator('[value="licenses.create"]')).not.toBeChecked();
  if (process.env.UHM_CAPTURE_GUIDE) {
    await mkdir('test-results/mission-guide', { recursive: true });
    await page.locator('.modal-body').evaluate((el) => (el.scrollTop = 0));
    await page
      .getByRole('dialog')
      .screenshot({ path: 'test-results/mission-guide/custom-role.png' });
  }
  page.once('dialog', async (d) => {
    expect(d.message()).toContain('همهٔ اعضا');
    await d.accept();
  });
  await editor.getByRole('button', { name: 'ذخیره نقش', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const team = await (await request.get('/api/admin/team', { headers })).json();
  const role = team.roles.at(-1);
  expect(new Set(role.permissions)).toEqual(new Set(['licenses.read', 'analytics.read']));
  const secondId = crypto.randomUUID();
  expect(
    (
      await request.post(`/api/admin/roles/${secondId}`, {
        headers,
        data: {
          name: 'مشاهده محتوا ' + Date.now(),
          description: 'دسترسی مستقل دوم',
          permissions: ['content.read'],
          enabled: true,
          expected_version: 0,
        },
      })
    ).status(),
  ).toBe(200);
  const generated = await (
    await request.post('/api/admin/licenses', {
      headers,
      data: { tier: 'normal', count: 1, duration_days: 30 },
    })
  ).json();
  await page.reload();
  await page.getByRole('button', { name: 'واگذاری دسترسی جدید انتخاب لایسنس و مجوزها' }).click();
  const access = page.locator('#access-form');
  await access.locator('[name=license_id]').selectOption(generated.licenses[0].id);
  await access.locator('[name=role]').selectOption('viewer');
  for (const box of await access.locator('[name=permission]').all()) await box.uncheck();
  await access.locator(`[name=role_ids][value="${role.id}"]`).check();
  await access.locator(`[name=role_ids][value="${secondId}"]`).check();
  await access.locator('[name=permission][value="errors.read"]').check();
  if (process.env.UHM_CAPTURE_GUIDE) {
    await page.locator('.modal-body').evaluate((el) => (el.scrollTop = 0));
    await page
      .getByRole('dialog')
      .screenshot({ path: 'test-results/mission-guide/member-grants.png' });
  }
  page.once('dialog', (d) => d.accept());
  await access.getByRole('button', { name: 'ذخیره و اعمال دسترسی', exact: true }).click();
  await expect(access).toHaveCount(0);
  const result = await (await request.get('/api/admin/team', { headers })).json();
  const member = result.members.find((m: any) => m.id === generated.licenses[0].id);
  expect(new Set(member.role_ids)).toEqual(new Set([role.id, secondId]));
  expect(member.permissions).toEqual(['errors.read']);
});
test('calendar license issuance and fixed expiry editing persist through the real API', async ({
  page,
  request,
}) => {
  const token = (await (await request.post('/api/demo/session', { data: {} })).json()).token;
  const headers = { Authorization: `Bearer ${token}` };
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await page.locator('[data-nav=licenses]').click();
  await page.getByRole('button', { name: 'تولید لایسنس', exact: true }).click();
  const form = page.locator('#generate-form');
  const start = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const end = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  await form.locator('[name=starts_at]').fill(start);
  await form.locator('[name=expires_at]').fill(end);
  await form.getByRole('button', { name: 'تولید و نمایش کدها', exact: true }).click();
  await expect(page.locator('#codes')).toBeVisible();
  const rows = (await (await request.get('/api/admin/overview', { headers })).json()).licenses;
  const target = rows.find((l: any) => l.starts_at === new Date(start).toISOString());
  expect(target.expires_at).toBe(new Date(end).toISOString());
  await page.keyboard.press('Escape');
  await page.locator(`[data-license="${target.id}"]`).click();
  const dates = page.locator('#license-window');
  await expect(dates.locator('[name=starts_at]')).toHaveValue(start);
  if (process.env.UHM_CAPTURE_GUIDE)
    await dates.screenshot({ path: 'test-results/mission-guide/license-window.png' });
  const newEnd = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16);
  await dates.locator('[name=expires_at]').fill(newEnd);
  page.once('dialog', (d) => d.accept());
  await dates.getByRole('button', { name: 'ذخیره بازه اعتبار', exact: true }).click();
  await expect(dates).toHaveCount(0);
  const result = await (await request.get('/api/admin/overview', { headers })).json();
  expect(result.licenses.find((l: any) => l.id === target.id).expires_at).toBe(
    new Date(newEnd).toISOString(),
  );
  expect(
    result.events.some((e: any) => e.target === target.id && e.action === 'license.window.changed'),
  ).toBe(true);
});
