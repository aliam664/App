// Frontend IPC contract tests ONLY. The Rust suite separately exercises real files.
import { test, expect, type Page } from '@playwright/test';
async function bridge(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.nativeCalls = [];
    const callbacks: Record<number, (event: any) => void> = {};
    const listeners: Record<string, number[]> = {};
    let next = 0;
    w.emitNative = (event: string, payload: any) =>
      (listeners[event] || []).forEach((id) => callbacks[id]?.({ event, id, payload }));
    const files = [
      { path: 'content/cars/real/model.kn5', bytes: 90, external: true },
      { path: 'content/cars/real/ui/ui_car.json', bytes: 10, external: true },
    ];
    let finish: undefined | (() => void), reject: undefined | ((e: Error) => void);
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__TAURI_INTERNALS__ = {
      transformCallback: (fn: any) => {
        callbacks[++next] = fn;
        return next;
      },
      invoke: async (cmd: string, args: any = {}) => {
        w.nativeCalls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          (listeners[args.event] ||= []).push(args.handler);
          return next;
        }
        if (cmd === 'get_settings')
          return {
            game_path: 'C:\\Games\\AC',
            game_paths: ['C:\\Games\\AC'],
            autoscan: false,
            download_path: '',
            parallel_downloads: 2,
          };
        if (cmd === 'installed_packages') return {};
        if (cmd === 'scan_content')
          return {
            items: [
              {
                id: 'car:real',
                kind: 'car',
                parent: null,
                path: 'content/cars/real',
                metadata: { name: 'Real filesystem contract', brand: 'Test brand', country: 'US' },
                bytes: 100,
                files: 2,
                image: null,
                source: 'external',
                warnings: [],
              },
              {
                id: 'skin:red',
                kind: 'skin',
                parent: 'car:real',
                path: 'content/cars/real/skins/red',
                metadata: { skinname: 'Red' },
                bytes: 20,
                files: 1,
                image: null,
                source: 'launcher',
                warnings: [],
              },
            ],
            bytes: 100,
            scanned_at: 1793634000,
            warnings: [],
            packages: [],
          };
        if (cmd === 'deletion_preview') return { id: 'preview-fixture', files };
        if (cmd === 'quarantine_files') {
          if (!args.acknowledgeExternal)
            throw new Error('External content requires explicit acknowledgement');
          return { files: args.selected.length };
        }
        if (cmd === 'list_quarantine') return [];
        if (cmd === 'discover_paths')
          return {
            games: ['C:\\Games\\AC', 'D:\\Steam\\AC'],
            documents: ['C:\\Users\\Test\\Documents\\Assetto Corsa'],
            content_managers: [],
            content_manager_data: null,
            steam_libraries: ['D:\\Steam'],
          };
        if (cmd === 'set_game_path') return { path: args.path };
        if (cmd === 'set_autoscan' || cmd === 'set_download_preferences') return;
        if (cmd === 'download_cache_status')
          return { path: 'C:\\Games\\AC\\.uhm\\download-cache', bytes: 1024, files: 1 };
        if (cmd === 'install_plan')
          return new Promise((resolve, fail) => {
            finish = () => resolve({ success: true });
            reject = fail;
            queueMicrotask(() =>
              w.emitNative('install-job-state', {
                package_id: 'pkg-bridge',
                active: true,
                mode: 'prepare',
              }),
            );
          });
        if (cmd === 'control_job') {
          if (args.action === 'approve') finish?.();
          if (args.action === 'cancel') reject?.(new Error('CANCELLED_BY_USER'));
          return {
            paused: args.action === 'pause',
            cancel_requested: args.action === 'cancel',
            mode: 'download',
          };
        }
        throw new Error(`Unexpected native command ${cmd}`);
      },
    };
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/health'
        ? { mode: 'production' }
        : path === '/api/catalog'
          ? { packages: [] }
          : path === '/api/service/status'
            ? {
                settings: { maintenance: false, downloads_paused: false, activation_paused: false },
              }
            : null;
    if (body) await route.fulfill({ json: body });
    else await route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.hero-highlight')).toBeVisible();
}
test('native library reads scan contract, filters external items and requires file-level deletion acknowledgement', async ({
  page,
}) => {
  await bridge(page);
  await page.getByRole('button', { name: 'کتابخانه من', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Real filesystem contract', exact: true }),
  ).toBeVisible();
  await page.getByLabel('نوع محتوا').selectOption('skin');
  await expect(page.getByRole('button', { name: 'Red', exact: true })).toBeVisible();
  await page.getByLabel('نوع محتوا').selectOption('car');
  await page.getByRole('button', { name: 'Real filesystem contract', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('نامشخص');
  await page.getByRole('button', { name: 'بررسی فایل‌ها برای انتقال به قرنطینه' }).click();
  const confirmation = page.getByRole('dialog').last();
  await confirmation.locator('[data-delete-file]').last().uncheck();
  await confirmation.getByRole('checkbox', { name: /مسئولیت/ }).check();
  await confirmation.getByRole('button', { name: 'انتقال انتخاب‌ها به قرنطینه' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const call = await page.evaluate(() =>
    (window as any).nativeCalls.find((c: any) => c.cmd === 'quarantine_files'),
  );
  expect(call.args.selected).toEqual(['content/cars/real/model.kn5']);
  expect(call.args.acknowledgeExternal).toBe(true);
});
test('native discovery selection and cache preferences invoke actual named command contracts', async ({
  page,
}) => {
  await bridge(page);
  await page.getByRole('button', { name: 'تنظیمات کتابخانه', exact: true }).click();
  await page.getByRole('button', { name: 'کشف Steam و نصب‌های بازی' }).click();
  await page.locator('[data-game-path]').last().click();
  await page.getByRole('button', { name: 'تنظیمات', exact: true }).click();
  await page.locator('#download-parallel').selectOption('4');
  await page.getByRole('button', { name: 'ذخیره تنظیمات دانلود' }).click();
  await page.getByRole('button', { name: 'پاک‌سازی فایل‌های دانلود موقت' }).click();
  await expect(page.getByRole('dialog')).toContainText('قرنطینه دست‌نخورده');
  await page.locator('#clear-cache-confirm').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).nativeCalls);
  expect(calls.some((c: any) => c.cmd === 'set_game_path' && c.args.path === 'D:\\Steam\\AC')).toBe(
    true,
  );
  expect(
    calls.some((c: any) => c.cmd === 'set_download_preferences' && c.args.parallel === 4),
  ).toBe(true);
  expect(calls.some((c: any) => c.cmd === 'download_cache_status' && c.args.clear)).toBe(true);
});
async function startBridgeInstall(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('uhm-test-install', {
        detail: {
          plan: 'IPC-fixture-only-not-a-signed-token',
          packages: [{ id: 'pkg-bridge', name: 'IPC contract package', version: '1.0.0' }],
        },
      }),
    ),
  );
  await expect(
    page.getByRole('heading', { name: 'IPC contract package', exact: true }),
  ).toBeVisible();
}
test('installation awaits native file preview approval and transfer controls use the active package ID', async ({
  page,
}) => {
  await bridge(page);
  await startBridgeInstall(page);
  await page.evaluate(() =>
    (window as any).emitNative('install-progress', {
      package_id: 'pkg-bridge',
      phase: 'در حال دانلود و بررسی فایل',
      progress: 20,
      bytes: 20,
      total: 100,
      speed: 10,
      eta: 8,
    }),
  );
  await page.getByRole('button', { name: 'توقف دانلود', exact: true }).click();
  await page.getByRole('button', { name: 'ادامه', exact: true }).click();
  await page.evaluate(() =>
    (window as any).emitNative('install-preview', {
      id: 'real-preview-contract',
      package_id: 'pkg-bridge',
      name: 'Staged package',
      required: 100,
      free: 1000,
      files: [
        { path: 'content/cars/real/model.kn5', bytes: 100, overwrite: true, executable: false },
      ],
    }),
  );
  await expect(page.getByRole('dialog')).toContainText('content/cars/real/model.kn5');
  await expect(page.getByRole('dialog')).toContainText('بکاپ و جایگزینی');
  await page.getByRole('button', { name: 'تأیید و اعمال تغییرات' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.task')).toContainText('نصب تکمیل شد');
  const controls = await page.evaluate(() =>
    (window as any).nativeCalls.filter((c: any) => c.cmd === 'control_job').map((c: any) => c.args),
  );
  expect(controls.map((c: any) => c.action)).toEqual(['pause', 'resume', 'approve']);
  expect(controls[2]).toMatchObject({
    packageId: 'pkg-bridge',
    previewId: 'real-preview-contract',
  });
});
test('closing the staged preview cancels rather than authorizing game changes', async ({
  page,
}) => {
  await bridge(page);
  await startBridgeInstall(page);
  await page.evaluate(() =>
    (window as any).emitNative('install-preview', {
      id: 'cancel-preview',
      package_id: 'pkg-bridge',
      name: 'Staged package',
      required: 1,
      free: 100,
      files: [],
    }),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(page.locator('.task')).toContainText('CANCELLED_BY_USER');
  const controls = await page.evaluate(() =>
    (window as any).nativeCalls
      .filter((c: any) => c.cmd === 'control_job')
      .map((c: any) => c.args.action),
  );
  expect(controls).toEqual(['cancel']);
});
