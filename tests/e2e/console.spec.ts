import { test, expect } from '@playwright/test';
async function owner(request: any) {
  return (await (await request.post('/api/demo/session', { data: {} })).json()).token;
}
async function ownerUI(page: any) {
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'ورود به پنل نمایشی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
}
test('assigned license activates both app and staff console, with scoped profile permissions', async ({
  page,
  request,
}) => {
  const token = await owner(request);
  const generated = await (
    await request.post('/api/admin/licenses', {
      data: { tier: 'pro', count: 1, duration_days: 30 },
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const id = generated.licenses[0].id;
  await request.post(`/api/admin/team/${id}`, {
    data: {
      role: 'support',
      permissions: ['licenses.read', 'licenses.update', 'analytics.read', 'errors.read'],
      enabled: true,
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  await page.goto('/#/admin');
  await page.locator('#license-admin-login input').fill(generated.codes[0]);
  await page.getByRole('button', { name: 'ورود با لایسنس این دستگاه', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'همه‌چیز، زیر کنترل.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تیم و دسترسی‌ها', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'لایسنس‌ها', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تولید لایسنس', exact: true })).toHaveCount(0);
  await page.locator(`[data-license="${id}"]`).click();
  await page.locator('[name=display_name]').fill('پشتیبان یک');
  await page.locator('[name=notes]').fill('یادداشت داخلی تیم');
  await page.getByRole('button', { name: 'ذخیره مشخصات', exact: true }).click();
  await expect(page.locator('#license-table')).toContainText('پشتیبان یک');
  await page.getByRole('button', { name: 'بازگشت به لانچر', exact: true }).click();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
});
test('offline outbox survives a reload and uploads only acknowledged events after reconnection', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'فعال‌سازی لایسنس', exact: true }).click();
  await page.getByRole('button', { name: 'استفاده از لایسنس آزمایشی Pro' }).click();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
  await page.evaluate(async () => {
    const path = '/apps/web/src/outbox.ts';
    await (await import(path)).flushEvents();
  });
  await context.setOffline(true);
  const event = await page.evaluate(async () => {
    const path = '/apps/web/src/outbox.ts';
    const outbox = await import(path);
    await outbox.recordEvent('download_failed', {
      error_code: 'DOWNLOAD_FAILED',
      stage: 'download',
    });
    return (await outbox.pendingEvents()).find((e: any) => e.type === 'download_failed');
  });
  expect(event?.id).toBeTruthy();
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.profile')).toContainText('PRO MEMBER');
  const token = await owner(request);
  await expect
    .poll(
      async () => {
        const data = await (
          await request.get('/api/admin/overview', {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json();
        return data.telemetry.some((e: any) => e.id === event.id);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const pending = await page.evaluate(async () => {
    const path = '/apps/web/src/outbox.ts';
    return (await (await import(path)).pendingEvents()).some((e: any) => e.id === event.id);
  });
  expect(pending).toBe(false);
});
test('package studio preserves passwords, multiple destinations and editable ordered steps', async ({
  page,
  request,
}) => {
  await ownerUI(page);
  await page.getByRole('button', { name: 'پکیج‌ها', exact: true }).click();
  await page.getByRole('button', { name: 'پکیج جدید', exact: true }).click();
  const slug = 'studio-' + Date.now();
  await page.locator('[name=name]').fill('مود تست رمزدار');
  await page.locator('[name=slug]').fill(slug);
  await page
    .locator('textarea[name=description]')
    .fill('توضیحات کامل پکیج آزمایشی برای بررسی مراحل نصب و استخراج');
  await page.getByRole('button', { name: 'افزودن فایل', exact: true }).click();
  await page.locator('[data-f=name]').fill('mod.part1.rar');
  await page.locator('[data-f=format]').selectOption('rar');
  await page.locator('[data-f=url]').fill('https://files.example.com/mod.part1.rar');
  await page.locator('[data-f=sha256]').fill('a'.repeat(64));
  await page.locator('[data-f=size]').fill('1234');
  await page.locator('[data-f=archive_password]').fill('test-only-password');
  await page.getByRole('button', { name: 'افزودن مرحله', exact: true }).click();
  await page.locator('[data-step=destination]').nth(1).fill('content/cars');
  await page.getByRole('button', { name: 'ذخیره پیش‌نویس', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const token = await owner(request);
  const data = await (
    await request.get('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  const pkg = data.packages.find((p: any) => p.slug === slug);
  expect(pkg.files[0].archive_password).toBe('test-only-password');
  expect(pkg.steps).toHaveLength(2);
  expect(pkg.steps[1].destination).toBe('content/cars');
  await page.locator(`[data-edit="${pkg.id}"]`).click();
  await expect(page.locator('[data-f=archive_password]')).toHaveAttribute('type', 'password');
  await expect(page.locator('.install-step')).toHaveCount(2);
});
test('analytics, team and maintenance panels render responsively and apply real API controls', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ownerUI(page);
  await page.getByRole('button', { name: 'تحلیل عملکرد', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'عملکرد واقعی، نه حدس.' })).toBeVisible();
  await expect(page.locator('.bar-chart')).toBeVisible();
  await page.getByRole('button', { name: 'تیم و دسترسی‌ها', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'تیم شما. مرزهای روشن.' })).toBeVisible();
  await page.getByRole('button', { name: 'کنترل سرویس', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'کنترل سرویس، بدون قطع کور.' })).toBeVisible();
  const token = await owner(request);
  try {
    await page.locator('[name=issuance_paused]').check();
    await page.locator('[name=message]').fill('توقف آزمایشی صدور');
    await page.getByRole('button', { name: 'اعمال وضعیت سرویس', exact: true }).click();
    await expect
      .poll(async () =>
        (
          await request.post('/api/admin/licenses', {
            data: { tier: 'normal', count: 1, duration_days: 30 },
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status(),
      )
      .toBe(503);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await request.post('/api/admin/service', {
      data: {
        maintenance: false,
        activation_paused: false,
        issuance_paused: false,
        downloads_paused: false,
        message: '',
      },
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  expect(errors).toEqual([]);
});

test('owner can configure a second independent manager entirely through the team UI', async ({
  page,
  request,
}) => {
  const token = await owner(request);
  const generated = await (
    await request.post('/api/admin/licenses', {
      data: { tier: 'vip', count: 1, duration_days: 30 },
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const id = generated.licenses[0].id;
  await ownerUI(page);
  await page.getByRole('button', { name: 'تیم و دسترسی‌ها', exact: true }).click();
  await page.locator('#new-member').click();
  await page.locator('[name=license_id]').selectOption(id);
  await page.locator('[name=role]').selectOption('content_manager');
  await page.locator('[name=permission][value="analytics.read"]').uncheck();
  await page.getByRole('button', { name: 'ذخیره و اعمال دسترسی', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result = await (
    await request.get('/api/admin/team', { headers: { Authorization: `Bearer ${token}` } })
  ).json();
  const member = result.members.find((m: any) => m.id === id);
  expect(member.role).toBe('content_manager');
  expect(member.permissions).toContain('content.write');
  expect(member.permissions).not.toContain('analytics.read');
});
